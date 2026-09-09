# @rep/api — Supabase backend

Postgres schema + row level security + Deno edge functions for the exam-prep client. Implements
SPEC §5 (anti-sharing / entitlement), §6 (free tier vs. Complete), §7 (payments through a
merchant of record and RevenueCat — never Stripe), §8 (Supabase as the small backend) and the
v2 plan (docs/V2_PLAN.md): account-first, **server is the source of truth**, device-level free
tier, admin console, support, reviews, coupons, content versions.

The database holds **identity, entitlement, devices, learner state (settings, plan, sessions,
answers, srs progress), events and statistics**. It holds **no item text**. Items are delivered
as signed, short-lived batches built from the private `content` bucket (SPEC §5.4); this repo's
`content/` tree is the source of truth and `pipeline publish --remote` uploads it.

```
apps/api/
  deno.json                  root config: `deno task check|test|lint|fmt` across all functions
  package.json               pnpm scripts that shell out to the supabase cli + deno
  scripts/typecheck.mjs      `pnpm -r typecheck` shim: runs `deno check` when deno is installed
  scripts/pg-smoke.sh|sql    migrations + seed + behavioural smoke on a throwaway local postgres
  supabase/
    config.toml              local stack config (ports, auth, storage bucket, per-function verify_jwt)
    seed.sql                 local-only placeholder item_index rows + canary pool
    .env.example             secrets the functions need (copy to supabase/.env.local)
    migrations/
      0001_init.sql          enums, domains, helpers, audit_log
      0002_profiles.sql      profiles (home state, exam date, sharing_notice_ack, current_session_id)
      0003_entitlements.sql  entitlements, webhook_events, grant/revoke/transfer functions
      0004_devices_sessions.sql  devices, sessions (single live), fn_register_device … (device rule revised by 0015)
      0005_item_delivery.sql item_index (ids only), item_id_aliases, canary_items, item_batches, rate_limits
      0006_progress.sql      progress (lww), item_stats (trigger), study_sessions, fn_record_answer(s), fn_readiness_inputs
      0007_anomaly.sql       geo_events, anomaly_flags, email_outbox, fn_open_anomaly_flag
      0008_storage.sql       private buckets `batches` and `content`
      0009_admin.sql         profiles.is_admin, fn_make_admin(email)
      0010_v2_enums.sql      anomaly_kind + device_accounts, entitlement_source + coupon, fn_is_admin()
      0011_events_devices.sql  events, device_fingerprints, free_tier_usage, fn_touch_device_fingerprint, fn_device_free_tier …
      0012_study_state.sql   study_state, study_sessions widened, answers, progress + streak/history, fn_my_srs_cards
      0013_support_reviews_coupons.sql  support_tickets/messages, reviews (+ v_public_reviews), coupons, fn_redeem_coupon, entitlements.paused_until
      0014_admin_content.sql admin_audit, content_versions, content_alerts, admin rls, fn_admin_kpis/user/search_users …
    functions/
      _shared/               auth, db, hmac, response, limits, pure rule modules (+ tests)
      issue-batch/           signed item batches, srs-due first, look-ahead by blueprint node, device free tier
      sync-progress/         two-way lww sync + anomaly heuristics + re-verification email
      register-device/       takes over the single device slot, starts the single live session, touches the fingerprint
      remove-device/         signs a device out (slot frees immediately)
      track-event/           batches of learner events (anonymous allowed with x-device-hash)
      study-state/           settings + plan, merged server-side, lww
      mock-start/ mock-finish/  server-built timed mocks + server-side scoring
      redeem-coupon/ support/ help-ai/  coupons, contact-us threads, KB-grounded assistant (Groq)
      admin-api/             the admin console's only backend; every op → admin_audit
      webhook-paddle/        Paddle Billing (web)
      webhook-lemonsqueezy/  Lemon Squeezy (web)
      webhook-revenuecat/    RevenueCat (ios + android iap)
```

## Run locally

Prerequisites: [Supabase CLI](https://supabase.com/docs/guides/local-development) (needs Docker),
[Deno 2](https://deno.land), pnpm.

```bash
cd apps/api
pnpm db:start                 # supabase start  → postgres :54322, api :54321, studio :54323
pnpm db:reset                 # supabase db reset → applies migrations/*.sql then seed.sql
cp supabase/.env.example supabase/.env.local   # fill in BATCH_SIGNING_SECRET at minimum
pnpm functions:serve          # supabase functions serve --env-file supabase/.env.local
```

Functions are then at `http://127.0.0.1:54321/functions/v1/<name>`. Sign up a user in Studio
(or with supabase-js), grab the access token, and:

```bash
TOKEN=...   # supabase session access_token
FP=$(printf 'my-install-id' | shasum -a 256 | cut -d' ' -f1)

curl -s http://127.0.0.1:54321/functions/v1/register-device \
  -H "Authorization: Bearer $TOKEN" -H "x-device-hash: $FP" -H 'content-type: application/json' \
  -d "{\"fingerprint_hash\":\"$FP\",\"platform\":\"web\",\"name\":\"laptop\"}"
# → { device_id, session_id, device: { accounts, exhausted, blocked }, ... }

curl -s http://127.0.0.1:54321/functions/v1/issue-batch \
  -H "Authorization: Bearer $TOKEN" -H "x-device-id: $DEVICE" -H "x-session-id: $SESSION" -H "x-device-hash: $FP" \
  -H 'content-type: application/json' \
  -d '{"bank":"national_pearsonvue","jurisdiction":"FL","size":50}'
```

A fresh account is on the free tier: set `profiles.home_jurisdiction` first (the client does this
during onboarding; locally `update profiles set home_jurisdiction = 'FL' where id = '<uid>'`).
To unlock everything locally run, as postgres in the SQL editor:
`select fn_grant_entitlement('<uid>', 'complete', 'manual', null, null, '{"note":"dev"}');`

Locally there is no published content in the `content` bucket yet: set `CONTENT_STUB_MISSING=true`
in `.env.local` so batches carry placeholder stems instead of failing with `503 content_unavailable`.

Checks that run without Supabase:

```bash
pnpm check     # deno check on every function entrypoint and test
pnpm test      # deno test — pure rule modules (device rule, lww, anomaly, batch mix, hmac, webhook verify,
               #             device free tier, coupons, admin guard, kpi shaping, mock forms/scoring, srs mirror, help prompt)
pnpm lint      # deno lint
pnpm typecheck # what `pnpm -r typecheck` at the repo root runs; no-op with a warning if deno is missing
pnpm db:smoke  # migrations + seed + scripts/pg-smoke.sql on a throwaway local postgres (needs initdb/psql, not docker)
```

`db:smoke` stands in the `auth` and `storage` schemas with `scripts/pg-shim.sql` and then drives
the rules the way PostgREST would (`set role` + `request.jwt.claims`): single-device takeover,
single session, idempotent grants, aliasing, lww, `item_stats` deltas, RLS denials, anomaly dedupe,
and (v2) the ≥3-accounts device rule, per-device free tier, coupon redemption, entitlement pause,
study_state merge, answers alias resolution, frozen finished mocks, support/review RLS, admin
function guards and KPI shape. Last run: 2026-09-09, all green on Postgres 16.

## Environment variables

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected by the edge runtime.
Everything else lives in `supabase/.env.local` locally and `supabase secrets set` when hosted —
see `supabase/.env.example` for the full annotated list.

| var | used by | purpose |
|---|---|---|
| `BATCH_SIGNING_SECRET` | issue-batch, mock-start | HMAC key for batch signatures (SPEC §5.4) |
| `BATCH_TTL_SECONDS` | issue-batch, mock-start | batch validity, default 21600 |
| `BATCH_BUCKET` | issue-batch, mock-start | private storage bucket for per-batch json, default `batches` |
| `CONTENT_BUCKET` | issue-batch, mock-start, mock-finish | private bucket with `items/<bank>/<item_id>.json`, default `content` |
| `CONTENT_STUB_MISSING` | same | local dev only: placeholder text for items missing from the bucket |
| `GROQ_API_KEY` **(required for help-ai)** | help-ai | Groq OpenAI-compatible endpoint; the free router keys are in the repo-root `.env` |
| `HELP_AI_MODEL` | help-ai | default `openai/gpt-oss-120b` |
| `BREVO_API_KEY` (optional) | — | reserved for the email_outbox sender (ticket replies, re-verification); not wired yet |
| `PADDLE_WEBHOOK_SECRET`, `PADDLE_PRICE_ID_COMPLETE`, `PADDLE_PRICE_ID_PASS_GUARANTEE` | webhook-paddle | signature secret + price → product map |
| `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_VARIANT_ID_*` | webhook-lemonsqueezy | signing secret + variant → product map |
| `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_PRODUCT_ID_*`, `REVENUECAT_ALLOW_SANDBOX` | webhook-revenuecat | auth header value, optional hmac secret, product map |
| `IP_HASH_SALT` | all user functions | salt for hashed ips in `audit_log` / `admin_audit` |

## How the client talks to it

1. **Auth** — supabase-js, email + 6-digit code only (v2). Long-lived refresh tokens; the study
   path never re-prompts (F13).
2. **Device hash (v2)** — the client computes one stable sha256 per install (Android app-scoped id
   + model, iOS identifierForVendor, web fingerprint in a 1-year cookie + localStorage) and sends
   it as **`x-device-hash` on every function call**, signed-in or not. Every device-aware function
   calls `fn_touch_device_fingerprint`, which appends the account to the device's history and,
   when **≥ 3 accounts appear on one device inside 30 days**, opens an `anomaly_flags` row of kind
   `device_accounts` (re-verification email, soft) and marks the device `free_tier_exhausted_at`.
3. **Device + session** — after sign-in, `POST register-device` with `fingerprint_hash`
   (sha256 of a stable install id; usually the same value as the device hash), `platform`,
   optional `name` and `model`. The response carries `device_id` and `session_id`; send them as
   `x-device-id` / `x-session-id` on every later call. A sign-in elsewhere revokes this session
   and the next call returns `401 session_revoked` with a plain-language message (SPEC §5.3).
   Registration is never refused: one active device per account (0015), and this call takes the slot
   over, retiring the previous device. The response lists what it signed out in `signed_out`.
   `POST remove-device` signs a device out by hand; the slot frees at once.
4. **Items** — `POST issue-batch` with `{ bank, jurisdiction, kind, size, nodes?, form_id? }`.
   You get **public ids** (per-user aliases; real item ids never leave the server), a signed
   `content_url` for the batch json (real stems now — see "Content bucket contract"), an
   `expires_at`, and the HMAC `signature`. Cache the batch encrypted at rest; re-request after
   expiry. **Free tier (v2):** 40 questions in the home state + one `short` mock, where usage is
   `max(account usage, device usage)` per jurisdiction (`free_tier_usage`), so clearing storage and
   signing up with a new email on the same device continues from where the device left off. A
   blocked or shared device gets `402 free_tier_exhausted` with `reason: device_blocked |
   device_shared`; running out gives `402 free_tier_exhausted` with `reason: questions | mocks`;
   the wrong state / form gives `403 free_tier_one_state` / `free_tier_mock_form`. Every response
   echoes `free_tier: { remaining, total, mocks_remaining, jurisdiction }` for `useFreeTier()`.
   `429 rate_limited` above the hourly human ceiling.
5. **Mocks (v2)** — `POST mock-start { form_id, jurisdiction, national_bank? }` builds the session
   on the server: one batch per portion (national + state), a `study_sessions` row with
   `status = active`, `item_ids` (public ids in order), `portions` (per-bank batch refs incl.
   `content_url`), `time_limit_ms`. Resume by reading the row (PostgREST) and re-fetching the
   portion batches if expired. `POST mock-finish { session_id, answers: [{public_id, choice, ms}],
   time_used_s? }` scores against the keys in the content bucket, freezes the session
   (`status = finished`, `score`, `finished_at`; later client writes to those columns are ignored),
   writes `answers` rows and updates `progress` with the server SRS mirror. Idempotent.
   `form_id = "short"` = 20 items / 30 min (the free-tier mock); any other id = 120 items / 240 min
   (80 national + 40 state). Pass score 0.75. Published form definitions do not exist yet, so items
   are drawn fresh per session.
6. **Progress** — the client owns the red/yellow/green scheduler offline (F7, F10) and pushes
   `progress` rows keyed by public id (`attempts, correct, box, due_at, last_answered_at,
   client_updated_at` + v2 `streak`, `history`) and resumable `study_sessions` (all v2 columns
   accepted) to `POST sync-progress`, with `client_updated_at` on every row. The server merges
   last-write-wins, updates bank-wide `item_stats`, and returns rows newer than your `since`
   watermark so a new device catches up. `fn_my_srs_cards()` (rpc) returns the full card set by
   public id for hydration after sign-in. If a SPEC §5.3 heuristic trips, the response says
   `reverification_requested: true` and an email is queued — never a lockout.
7. **Settings + plan (v2)** — `POST study-state { op: "get" }` / `{ op: "put", settings?: patch,
   plan?, replace_plan?, client_updated_at? }` → `{ settings, plan, client_updated_at, updated_at }`.
   `settings` is merged as a patch; the row is also readable/writable via PostgREST (`study_state`).
8. **Events (v2)** — `POST track-event { events: [{ kind, props?, at? }] }`, anonymous allowed with
   `x-device-hash`. Kinds are a closed list (`_shared/events.ts`: `app_open, sign_in, sign_out,
   answer, session_start, session_resume, mock_start, mock_finish, purchase_started,
   purchase_succeeded, purchase_failed, restore, review_submitted, help_search, help_ai_question,
   ticket_created, coupon_redeemed, settings_changed, content_refreshed`); unknown kinds are
   counted in `rejected`, not stored. The server adds its own (`device_seen, device_registered,
   batch_issued, progress_synced, ticket_reply, free_tier_blocked`, plus `mock_start/mock_finish`
   with `server: true`, `coupon_redeemed`, `help_ai_question`).
9. **Support / help / reviews / coupons (v2)** —
   `POST support { op: "ticket.create", subject, body, category? }` / `ticket.reply { ticket_id,
   body }` / `ticket.list` (tickets with messages). `POST help-ai { question, context?: string[] }`
   → `{ answer, sources, model }`, where `context` is the help.json entries the client's own search
   matched (plain text or json `{ title, url?, body }`); `503 help_ai_unavailable` when
   `GROQ_API_KEY` is unset. Reviews: insert/update your own `reviews` row via PostgREST (one per
   account, `status` is admin-owned; editing resets it to pending); the landing page reads
   `v_public_reviews` anonymously. `POST redeem-coupon { code }` → `{ ok, kind, product, value,
   granted }` or `{ ok: false, error: invalid_code | coupon_disabled | coupon_expired |
   already_redeemed | coupon_exhausted | already_entitled }`; a `gift` code grants immediately
   (refresh entitlements), percent/amount codes are recorded for the web checkout.
10. **Content versions (v2)** — `content_versions` is readable anonymously; check the newest
    `published_at` once a day and refresh the item cache when it changes.
11. **Direct reads** — RLS lets the signed-in user `select` their own `profiles`, `entitlements`,
    `v_my_devices`, `v_my_batches`, `progress`, `study_sessions`, `study_state`, `answers`,
    `free_tier_usage` (user scope), `support_tickets` (+ messages), `reviews`, `events`,
    `anomaly_flags`, `audit_log`, and call `fn_readiness_inputs(uid, jurisdiction)`,
    `fn_my_srs_cards()`. Direct `progress` / `study_sessions` / `answers` writes go through the
    same triggers, but prefer the functions so the anomaly and free-tier checks run.
12. **Honest UX flag** — `profiles.sharing_notice_ack` records that the user saw *"Your readiness
    score assumes one person is answering. Sharing this account will make it inaccurate."*

## Content bucket contract (what `pipeline publish --remote` must upload)

Private bucket `content` (0008), written with the service role:

- `items/<bank>/<item_id>.json` — one object per **published** item, exactly the `Item` schema from
  `packages/schema/src/item.ts` (`id, jurisdiction, bank, blueprint_node, vendor, license_level,
  cognitive_level, stem, options[4], key, explanation, citation{source,url,quoted_text,secondary},
  math?, terms, tags, status, reviewer, verified_on, qa_approved_on, version, provenance?`).
  **Options in stored order, `key` included** — the server keeps `key` (mock-finish scores with it)
  and also ships it in batches so the client grades offline. Canary variants (`CAN-<16 hex>`) go under
  the bank their `item_index` row names.
- `item_index` rows for every object (id, bank, jurisdiction, blueprint_node, cognitive_level,
  license_level, status, is_canary) — the server selects by id and needs the bank for the path.
- `content_versions` row per publish (`version` unique, `item_count`, `banks` jsonb counts,
  `manifest_path` optional).

`_shared/content-store.ts` builds the per-batch document at `batches/<user_id>/<batch_id>.json`:
`{ batch_id, version: "batch-v2", issued_at, items: [{ public_id, jurisdiction, bank, blueprint_node,
cognitive_level, license_level, stem, options, key, explanation, citation, math, terms, version }],
missing: [] }`. Real ids, reviewer, provenance, status and tags are stripped. Items whose object is
missing are dropped **before** signing, so signature, row and document always agree; if every item is
missing the call fails `503 content_unavailable` (or, with `CONTENT_STUB_MISSING=true`, ships stubs).

## admin-api (WP-D contract, V2_PLAN §6.2)

`POST /functions/v1/admin-api` with the JWT of a user whose `profiles.is_admin` is true (checked
from the profile row, never from a claim), body `{ op, params }`. Response `{ ok: true, data }` or
`{ ok: false, error, code }` (400 bad params, 401 no token, 403 `not_admin`, 404 `*_not_found`).
**Every call — reads included, failed ops too — writes one `admin_audit` row.**

| op | params → data |
|---|---|
| `kpis` | `{ range: 7d\|30d\|90d\|all }` → `{ range, signups, dau, wau, mau, purchases[{store,count,revenue_usd}], refunds, active_complete, active_guarantee, conversion_pct, mocks_completed, answers, tickets_open, reviews_pending, series[{date,signups,purchases,answers}] }` (series gap-free, ascending) |
| `users.search` | `{ q?, limit?, cursor? }` → `{ users[{id,email,created_at,last_sign_in_at,is_admin,disabled,entitlements[],devices,home_jurisdiction}], next, total }` (`cursor` = offset string) |
| `users.get` | `{ id }` → `{ id, auth{email,created_at,last_sign_in_at,banned_until}, profile, entitlements[], devices[], device_fingerprints[], sessions[], free_tier{jur:{questions_used,mocks_used}}, study{answers,accuracy,mocks,items_seen,items_green,leeches,last_answered_at}, events[≤200], tickets[], reviews[], coupons[], anomaly_flags[] }` |
| `users.disable` / `users.enable` | `{ id, reason? }` / `{ id }` — auth ban (`ban_duration`) + app sessions revoked |
| `users.sendCode` | `{ id }` — sends the OTP email to the user |
| `users.removeDevice` | `{ id, device_id }` — `fn_remove_device` (signs it out; slot frees at once) |
| `users.setAdmin` | `{ id, is_admin }` |
| `entitlements.grant` | `{ user_id, product, note? }` — source `manual`, idempotent on `manual:<uid>:<product>` |
| `entitlements.revoke` | `{ user_id, product, reason? }` |
| `entitlements.pause` / `.resume` | `{ user_id, product, until }` / `{ user_id, product }` — `paused_until`; `fn_has_entitlement` treats paused as not live |
| `coupons.create` | `{ kind: percent\|amount\|gift, value?, product?, max_uses?, expires_at?, note?, count? ≤200 }` → `{ coupons[], codes[] }` (`XXXX-XXXX-XXXX`) |
| `coupons.list` / `coupons.disable` | — / `{ code }` |
| `tickets.list` | `{ status?, cursor?, limit? }` → `{ tickets[+email,last_message,messages], next }` |
| `tickets.get` / `tickets.reply` / `tickets.close` | `{ id }` / `{ id, body }` (queues `email_outbox` template `ticket_reply`) / `{ id }` |
| `reviews.list` / `reviews.setStatus` | `{ status? }` / `{ id, status }` |
| `events.list` | `{ user_id?, kind?, since?, limit? ≤1000 }` |
| `audit.list` | `{ limit?, cursor? }` (cursor = `created_at` of the last row) |
| `content.alerts` / `content.resolveAlert` / `content.versions` | `{ status? }` / `{ id }` / — |
| `devices.flagged` | `{ limit? }` → devices with ≥3 accounts, blocked or exhausted |
| `devices.block` | `{ device_hash, blocked, notes? }` |

## Schema at a glance

Every table: uuid pk (or natural composite), `created_at timestamptz default now()`, RLS enabled.
Users only ever see `user_id = auth.uid()`; admins (`fn_is_admin()`) can additionally read the
tables the console shows. Tables marked *service* have no client policies.

| table | key rule |
|---|---|
| `profiles` | one per auth user (trigger). `current_session_id` + `last_reverified_at` are server-owned. `is_admin` (0009). |
| `entitlements` | `complete` / `pass_guarantee`; live = `revoked_at is null and (paused_until is null or past)`. Unique on `(source, external_id, product)` → idempotent grants. Sources now include `coupon`. |
| `webhook_events` *(service)* | unique `(provider, event_id)`; a failed attempt leaves `processed_at` null so the provider retry is reprocessed. |
| `devices` | unique `(user_id, fingerprint_hash)`; one active row per user, newest sign-in wins (0015). `cooldown_until` is vestigial and always null. |
| `device_fingerprints` *(service + admin read)* | pk `device_hash`; `account_ids[]`, `account_history` (first-seen per account), `blocked`, `free_tier_exhausted_at`. `fn_touch_device_fingerprint` applies the ≥3-in-30-days rule. |
| `free_tier_usage` | pk `(scope user\|device, scope_id, jurisdiction)`; `questions_used`, `mocks_used`. Owner reads the user scope. `fn_user_free_tier`, `fn_device_free_tier`, `fn_bump_free_tier_usage`. |
| `sessions` | one live row per account (0004). |
| `events` | learner + server events; owner reads, owner may insert directly; admins read all. |
| `study_state` | pk `user_id`; `settings` jsonb, `plan` jsonb, lww on `client_updated_at`; `fn_study_state_put` merges. |
| `study_sessions` | client or server uuid; v2 columns `item_ids` (public ids), `portions`, `time_limit_ms`, `status`, `score`, `finished_at`, `device_hash`, `time_used_s`; lww; a `finished` session is frozen for client writes. |
| `answers` | one row per answered question; client writes `public_id`, a security-definer trigger resolves `item_id`; unique `(session_id, public_id)`. |
| `progress` | pk `(user_id, item_id)`; lww; `leech = misses >= 4`; v2 `streak`, `history`. `fn_record_answers`, `fn_progress_since`, `fn_my_srs_cards`. |
| `item_index`, `item_id_aliases`, `canary_items`, `item_batches`, `rate_limits` | SPEC §5.4 delivery (0005). |
| `item_stats` *(service)* | attempts / correct per item; `v_item_pvalues`. |
| `support_tickets` / `support_messages` | owner + admin read; owner posts as `user` only; an admin message sets `answered`, a user message re-opens. |
| `reviews` | one per account; owner-editable; `status` admin-owned (edit → pending); `v_public_reviews` for anon. |
| `coupons` / `coupon_redemptions` | admin read; `fn_redeem_coupon(user, code)` (service) validates, records, grants gifts. |
| `admin_audit` | admin read; written by admin-api only. |
| `content_versions` | anon-readable; one row per publish. |
| `content_alerts` | admin read; written by the nightly pipeline job (service). |
| `geo_events`, `anomaly_flags` (+ kind `device_accounts`), `email_outbox`, `audit_log` | 0007 / 0001. |

Key functions: `fn_register_device`, `fn_remove_device`, `fn_start_session`, `fn_session_is_valid`,
`fn_record_answer(s)`, `fn_progress_since`, `fn_my_srs_cards`, `fn_batch_candidates`,
`fn_readiness_inputs`, `fn_rate_limit_hit`, `fn_open_anomaly_flag`, `fn_grant_entitlement`,
`fn_revoke_entitlement`, `fn_revoke_entitlement_by_user`, `fn_pause_entitlement`,
`fn_transfer_entitlements`, `fn_touch_device_fingerprint`, `fn_device_free_tier`,
`fn_user_free_tier`, `fn_bump_free_tier_usage`, `fn_study_state_put`, `fn_redeem_coupon`,
`fn_is_admin`, `fn_assert_admin`, `fn_admin_kpis(range)`, `fn_admin_user(uid)`,
`fn_admin_search_users(q, limit, offset)`, `fn_admin_emails(ids)`, `fn_admin_flagged_devices`.

Numbers live in one place per side: `functions/_shared/limits.ts` and the comments in
`migrations/0004_devices_sessions.sql` / `0011_events_devices.sql`. Keep them in sync.

## Granting admins

```sql
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.fn_make_admin('founder@example.com');   -- sets profiles.is_admin, grants both products (manual)
commit;
```

Or, from the console once one admin exists: `users.setAdmin { id, is_admin: true }`. Admin status is
read from `profiles.is_admin` on every admin-api call, so revoking it takes effect immediately.

## Payments: what is deliberately NOT here

- **No Stripe.** Stripe does not onboard sellers in Ghana (SPEC §7). Web checkout is hosted by a
  merchant of record — Paddle or Lemon Squeezy — who is the legal seller and handles tax. Our
  side is only the webhook that grants the entitlement. Pass the Supabase user id as
  `custom_data.user_id` (Paddle) / `checkout[custom][user_id]` (Lemon Squeezy) so the grant
  matches; email is the fallback (`fn_user_id_by_email`), otherwise the event is stored as
  `unmatched_user` for support.
- **No StoreKit / Play Billing code.** Mobile goes through RevenueCat; the client calls
  `Purchases.logIn(<supabase uid>)` before purchasing and RevenueCat's webhook grants here.
- **Disable Family Sharing** on both non-consumable products in App Store Connect (SPEC §5.3).
- **No checkout UI, receipts, invoices or tax logic.** The merchant of record owns them. Percent /
  amount coupons are validated and recorded here; applying them is the web checkout's job.
- **No email provider.** Re-verification and ticket-reply mail is queued in `email_outbox`; sending
  is a stub (`_shared/email.ts`). `BREVO_API_KEY` is reserved for the worker.
- **No cron.** `rate_limits` garbage-collects opportunistically; add pg_cron for that and for
  draining `email_outbox`.

## Verification notes

- 2026-09-08: import style `npm:@supabase/supabase-js@2.116.0`, `Deno.serve` entrypoints. Paddle /
  Lemon Squeezy / RevenueCat signature schemes confirmed against provider docs (see webhooks.ts).
- 2026-09-09 (v2): all 14 migrations + the extended smoke run green on vanilla Postgres 16
  (`pnpm db:smoke`); `deno task check|test|lint|fmt:check` green (61 tests). Not yet run against the
  hosted project: `supabase db push` for 0010–0014 and `functions deploy` for the 8 new/changed
  functions — deploy after review. `users.disable` uses `auth.admin.updateUserById({ ban_duration })`;
  it revokes our app sessions but cannot revoke already-issued Supabase refresh tokens by user id
  from supabase-js — the ban makes the next refresh fail, which is the intended effect.
- Groq: `POST https://api.groq.com/openai/v1/chat/completions`, model `openai/gpt-oss-120b`,
  bearer `GROQ_API_KEY`; 25 s timeout, 400 max tokens, temperature 0.2. Confirm the model id is
  still listed on Groq before launch (`HELP_AI_MODEL` overrides).

## Deployment record

- 2026-09-08: linked to hosted project `lstgofflpwhdriiqyltu` (`https://lstgofflpwhdriiqyltu.supabase.co`); migrations 0001–0008 applied
  (`0008_storage.sql` adds private buckets `batches` and `content`); all 7 edge functions deployed with `supabase functions deploy --use-api`;
  secrets set: `BATCH_SIGNING_SECRET`, `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_ALLOW_SANDBOX=true`, `BATCH_BUCKET=batches`
  (values live in the repo-root `.env`, never in git). Smoke: `issue-batch` without a token → 401; `webhook-revenuecat` with a wrong
  Authorization header → 401 bad_signature.
- RevenueCat webhook URL: `https://lstgofflpwhdriiqyltu.supabase.co/functions/v1/webhook-revenuecat` with header
  `Authorization: <REVENUECAT_WEBHOOK_AUTH>`.
- Still to set when products exist: `REVENUECAT_PRODUCT_ID_COMPLETE`, `REVENUECAT_PRODUCT_ID_PASS_GUARANTEE`; Paddle / Lemon Squeezy secrets when web checkout is chosen.
- pgcrypto note: hosted projects keep extensions in the `extensions` schema; `fn_random_token` calls `extensions.gen_random_bytes`.
- **v2, pending deploy:** `supabase db push` (0009 if not yet applied, then 0010–0014); `supabase functions deploy` for
  `admin-api track-event redeem-coupon support help-ai study-state mock-start mock-finish issue-batch register-device sync-progress`
  (`track-event` needs `--no-verify-jwt`, see config.toml); `supabase secrets set GROQ_API_KEY=… CONTENT_BUCKET=content`.

## Super-admin accounts

Migration `0009_admin.sql` adds `profiles.is_admin` and `fn_make_admin(email)`, which flags the profile and grants
`complete` + `pass_guarantee` with source `manual` (idempotent). It must run with service-role claims (SQL above).

The client shows admins the store buttons even when already entitled ("Test purchase") so sandbox IAP can be
exercised end to end. Sandbox webhook events are only honoured while the `REVENUECAT_ALLOW_SANDBOX` secret is `true`.
