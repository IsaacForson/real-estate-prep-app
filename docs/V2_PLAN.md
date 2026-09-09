# V2 plan — account-first, server-authoritative, admin console (2026-09-09)

Forson's direction (2026-09-09): the app must look and feel like a professional mobile product (not the
website squeezed down), sign-in comes before anything else, every piece of learner state lives in the
database (not the device), free-tier abuse via "clear storage + new email" must be blocked with device
tracking, and one admin console (only Forson) is the single source of truth across web/Android/iOS.

## 1. Product rules (decisions)
- **Auth-first.** Web: public landing (marketing, states, pricing, reviews, legal) → everything under
  `/app/**` requires a session. Mobile (Capacitor): onboarding carousel → sign-in screen; nothing else is
  reachable signed out. Sign-in = email + 6-digit code only. Google/Apple buttons removed everywhere.
- **Server is the source of truth.** Answers, SRS boxes, mock sessions (incl. in-progress/resumable),
  results, study plan, settings (home state, exam date, theme), narration preferences: all rows in
  Supabase keyed by `user_id`. Dexie/IndexedDB is a **read cache + offline write queue only**. Clearing
  storage loses nothing; signing in on a new device hydrates from the server.
- **Device tracking.** Every session carries a `device_hash` (Android: `Device.getId()` app-scoped id +
  model; iOS: identifierForVendor; web: stable fingerprint from lib/study/fingerprint.ts stored in a
  1-year cookie + localStorage). Free-tier consumption is counted **per device and per account**, and a
  device inherits the maximum of both. A device that has been used by ≥3 accounts in 30 days is
  flagged (`anomaly_flags` kind `device_accounts`) and its free tier is exhausted for all new accounts.
- **Free tier** stays: 40 questions in one state + one short mock, but enforced only server-side
  (`issue-batch` / `mock-start`) with the device rule above.
- **Admin console**: `/admin/**` (web only, SSR off), visible only when `profiles.is_admin`; all
  privileged reads/writes go through the `admin-api` edge function (service role) which writes an
  `admin_audit` row for every action. Learner actions are recorded in `events` (see §3) so the admin sees
  everything a user did.
- **Support**: in-app Help Center searches a knowledge base generated from the repo docs
  (`scripts/build-help-kb.ts` → `apps/app/public/content/help.json`); unanswered questions can be asked
  to an AI (edge function `help-ai`, Groq via the free router keys, grounded on the KB) and every
  question is logged. "Contact us" creates a `support_tickets` thread the admin answers in the console.
- **Reviews**: `reviews` (1–5 stars + text), prompted after the first completed mock and from Account;
  admin approves; approved ones show on the landing page.
- **Coupons**: admin-generated codes (`coupons`): percent/amount for the future web checkout, and
  100 %/"gift" codes that grant `complete` immediately on redemption (`redeem-coupon`).
- **Content freshness**: nightly GitHub Action runs `pipeline watch-sources` (re-fetch every cached
  authority URL, hash-compare, flag items whose citations changed → `content_alerts` + refs-audit +
  docs/STATUTE_CHANGES.md) and `pipeline publish --remote` (approved items → Supabase `content`
  bucket + `content_versions`). The app checks `content_versions` daily and refreshes its item cache
  without a store release.

## 2. Data model additions (migrations 0010+)
- `events(id, user_id, device_hash, kind text, props jsonb, created_at)` — client + server emitted;
  kinds: `app_open, sign_in, sign_out, answer, session_start, session_resume, mock_start, mock_finish,
  purchase_started, purchase_succeeded, purchase_failed, restore, review_submitted, help_search,
  help_ai_question, ticket_created, coupon_redeemed, settings_changed, content_refreshed`.
- `device_fingerprints(device_hash pk, platform, model, first_seen, last_seen, account_ids uuid[],
  blocked boolean, notes)`; `free_tier_usage(scope text check in ('user','device'), scope_id text,
  jurisdiction, questions_used int, mocks_used int, updated_at)`.
- `study_state(user_id pk, settings jsonb, plan jsonb, updated_at)`; `study_sessions(id, user_id,
  kind practice|mock, jurisdiction, bank, form_id, status active|finished|abandoned, started_at,
  finished_at, position int, item_ids text[], answers jsonb, score numeric, time_used_s int,
  device_hash)`; `answers(id, user_id, item_id, session_id, chosen, correct, ms, answered_at)`;
  `srs_cards(user_id, item_id, box, due_at, lapses, last_answered_at)`. (Existing `progress` tables from
  0006 are migrated/aliased; keep LWW on `updated_at`.)
- `support_tickets(id, user_id, subject, status open|answered|closed, category, created_at,
  updated_at)`; `support_messages(id, ticket_id, author user|admin, body, created_at)`.
- `reviews(id, user_id, rating int, body, status pending|approved|rejected, created_at, jurisdiction)`.
- `coupons(code pk, kind percent|amount|gift, value numeric, product, max_uses, uses, expires_at,
  created_by, note)`; `coupon_redemptions(id, code, user_id, redeemed_at)`.
- `admin_audit(id, admin_id, action, target_type, target_id, before jsonb, after jsonb, created_at)`.
- `content_versions(id, version text, published_at, item_count, notes)`; `content_alerts(id, kind,
  jurisdiction, ref, detail jsonb, status open|resolved, created_at)`.
- Views for analytics (security-definer functions callable by admins only): `fn_admin_kpis(range)`
  → signups, DAU/WAU, purchases by store, revenue (from webhook payloads), refunds, active
  entitlements, free→paid conversion, mocks completed, tickets open; `fn_admin_user(uid)` → full
  profile + devices + entitlements + events timeline.

## 3. Edge functions
- `admin-api` (POST, requires admin JWT): `users.search`, `users.get`, `users.disable/enable`
  (auth admin ban), `users.sendCode` (send OTP on their behalf), `users.removeDevice`,
  `entitlements.grant/revoke/pause/resume`, `coupons.create/list/disable`, `tickets.list/reply/close`,
  `reviews.list/approve/reject`, `kpis`, `events.list`, `content.alerts`. Every call → `admin_audit`.
- `track-event` (POST, user JWT or anon+device_hash): batches of events.
- `redeem-coupon` (POST, user JWT).
- `support` (POST, user JWT): `ticket.create`, `ticket.reply`, `ticket.list`.
- `help-ai` (POST, user JWT): KB-grounded answer via Groq; logs `help_ai_question`.
- `issue-batch`, `register-device`, `sync-progress`: accept `device_hash`, enforce device free tier,
  write `events`.
- `mock-start` / `mock-finish` (or fold into `sync-progress`): server-side mock session + scoring.

## 4. Client architecture
- `lib/state/repo.ts`: repository for study state — Supabase primary (PostgREST under RLS, batched),
  Dexie cache, offline outbox replayed by `useSync`. All composables (`useStudy`, `useFreeTier`,
  `useSettings`…) read/write through it; nothing persists to Dexie as a primary store.
- Route middleware `auth.global.ts`: unauthenticated → `/welcome` (mobile) or landing (web).
- `composables/useDevice.ts`: device hash + registration on sign-in; `useEvents.ts`: track().
- Mobile shell (`layouts/mobile.vue`): bottom tab bar Home · Study · Mocks · Review · Account, large
  touch targets, safe areas, sheet-style modals. Web shell (`layouts/web.vue`): top nav + landing.
  Tailwind v4 with tokens in `assets/main.css` (`bg-surface`, `text-ink`, `text-muted`, `border-line`,
  `bg-accent`, …). No component library; small local components (Button, Card, Sheet, Tabs, Stat).
- Screens: Welcome/onboarding, Sign in, Home (readiness, plan, continue session), Study (practice by
  domain), Mocks (forms, resume), Review (missed, SRS), Glossary, Account (entitlement, devices,
  settings, reviews, help, contact), Pricing (store prices, no admin buttons), Help Center, Contact,
  Landing (web), Admin (web).

## 5. Work packages (parallel)
- **WP-A backend** (apps/api): migrations 0010–0016, functions above, Deno tests, README contracts.
- **WP-B client core** (apps/app/lib, composables, middleware, plugins): repo layer, auth-first,
  device hash, events, remove OAuth, pricing fix; keep pages compiling.
- **WP-C UI** (apps/app/app/pages, components, layouts): Tailwind redesign per §4; landing page.
- **WP-D admin console** (apps/app/app/pages/admin/**, composables/useAdmin.ts).
- **WP-E pipeline/ops** (packages/pipeline, scripts, .github/workflows): watch-sources, publish
  --remote, help KB build, nightly workflow, docs.
Acceptance: `pnpm -r test`, `pnpm --filter @rep/app exec nuxi typecheck`, `nuxi generate`, Android
bundle builds; a signed-out user sees only welcome/sign-in; clearing storage and re-signing-in shows
the same progress; a new email on a used device gets no extra free questions; admin console shows
KPIs, users, tickets, reviews, coupons, alerts, audit.

## 6. Contracts (so packages can build in parallel)

### 6.1 Client composables (WP-B owns; WP-C consumes; keep names stable)
- `useAuth()` unchanged API + `signInWithEmail(email)`, `verifyEmailCode(email, code)`, `signOut()`; `signInWithOAuth` removed.
- `useDevice()` → `{ hash: Ref<string|null>, platform, ensure(): Promise<string> }` (hash computed once, persisted; sent on every function call as header `x-device-hash`).
- `useEvents()` → `{ track(kind: EventKind, props?: Record<string, unknown>): void }` (batched, offline-queued, flushed by useSync).
- `useStudyState()` → server-backed settings/plan: `{ settings: Ref<StudySettings>, set(patch), plan: Ref<Plan|null>, ready: Ref<boolean> }` (replaces Pinia settings for learner-scoped values; theme stays local).
- `useStudy()` keeps: `startPractice(opts)`, `startMock(formId)`, `resume(sessionId)`, `answer(choice)`, `next()`, `finish()`, `current: Ref<Item|null>`, `session: Ref<StudySession|null>`, `progressFor(itemId)`, `activeSession: Ref<StudySession|null>` — now writing through the repo (server first, cache second).
- `useReadiness()`, `useCoverage()`, `usePlan()` — computed from server rows (hydrated by repo), same shapes as today's lib functions.
- `useFreeTier()` → `{ remaining: Ref<number>, mocksRemaining: Ref<number>, jurisdiction, exhausted: Ref<boolean>, load() }` server-fed (from issue-batch responses + `free_tier_usage`).
- `useHelp()` → `{ search(q): HelpArticle[], ask(q): Promise<{answer, sources}> }`; `useSupport()` → `{ tickets, create(subject, body, category), reply(ticketId, body), load() }`; `useReviews()` → `{ mine, submit(rating, body), approved: Ref<Review[]> (public, for landing) }`; `useCoupons()` → `{ redeem(code): Promise<{ok, product?, error?}> }`.
- `useEntitlement()` unchanged (`isComplete`, `hasGuarantee`, `isAdmin`, `load`, `refresh`), but hydrated as part of auth init before any page renders (no flash of free tier).
- Route middleware: `middleware/auth.global.ts` redirects signed-out users to `/welcome` for all routes except the public list: `/`, `/pricing`, `/states/**`, `/methodology`, `/legal/**`, `/welcome`, `/signin`, `/help`, `/reviews`. On Capacitor the landing `/` also redirects to `/welcome`.
- Layout selection: `definePageMeta({ layout: "mobile" | "web" | "admin" })`; a plugin sets `default` to `mobile` when `Capacitor.isNativePlatform()`, else `web`.

### 6.2 `admin-api` (WP-A owns; WP-D consumes). POST `/functions/v1/admin-api`, JSON `{ op, params }`, JWT of an `is_admin` user; 403 otherwise. Response `{ ok: true, data }` or `{ ok: false, error, code }`. Ops:
- `kpis` `{ range: "7d"|"30d"|"90d"|"all" }` → `{ signups, dau, wau, mau, purchases: {store, count, revenue_usd}[], refunds, active_complete, active_guarantee, conversion_pct, mocks_completed, answers, tickets_open, reviews_pending, series: {date, signups, purchases, answers}[] }`
- `users.search` `{ q, limit, cursor }` → `{ users: {id, email, created_at, last_sign_in_at, is_admin, disabled, entitlements: string[], devices: number, home_jurisdiction}[], next }`
- `users.get` `{ id }` → `{ profile, auth: {email, created_at, last_sign_in_at, banned_until}, entitlements[], devices[], sessions[], free_tier: {questions_used, mocks_used}, study: {answers, accuracy, mocks, readiness}, events: Event[] (latest 200), tickets[], reviews[], coupons[] }`
- `users.disable` `{ id, reason }` / `users.enable` `{ id }` (auth admin ban / unban, revoke sessions)
- `users.sendCode` `{ id }` (send OTP email to the user), `users.removeDevice` `{ id, device_id }`, `users.setAdmin` `{ id, is_admin }`
- `entitlements.grant` `{ user_id, product, note }`, `entitlements.revoke` `{ user_id, product, reason }`, `entitlements.pause` `{ user_id, product, until }`, `entitlements.resume` `{ user_id, product }`
- `coupons.create` `{ kind, value, product, max_uses, expires_at, note, count }` → generated codes; `coupons.list`, `coupons.disable` `{ code }`
- `tickets.list` `{ status?, cursor }`, `tickets.get` `{ id }`, `tickets.reply` `{ id, body }`, `tickets.close` `{ id }`
- `reviews.list` `{ status? }`, `reviews.setStatus` `{ id, status }`
- `events.list` `{ user_id?, kind?, since?, limit }`, `audit.list` `{ limit, cursor }`
- `content.alerts` `{ status? }`, `content.resolveAlert` `{ id }`, `content.versions`
- `devices.flagged` → device_fingerprints with ≥3 accounts or blocked; `devices.block` `{ device_hash, blocked, notes }`
Every op writes `admin_audit(admin_id, action=op, target_type, target_id, before, after)`.

### 6.3 Other functions (WP-A): `track-event` `{ events: {kind, props, at}[] }` (header `x-device-hash`); `redeem-coupon` `{ code }` → `{ ok, product?, kind?, error? }`; `support` `{ op: "ticket.create"|"ticket.reply"|"ticket.list", ... }`; `help-ai` `{ question, context?: string[] }` → `{ answer, sources: string[] }`; `study-state` `{ op: "get" | "put", settings?, plan? }` (or PostgREST on `study_state`); `mock-start` `{ form_id, jurisdiction }` → server-built session; `mock-finish` `{ session_id, answers }` → score. `issue-batch`/`register-device`/`sync-progress` read `x-device-hash` and enforce the device free tier; `content-store.buildBatch` must read real item YAML → JSON from the `content` bucket (published by `pipeline publish --remote`).
