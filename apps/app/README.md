# @rep/app — client (web + iOS + Android)

Nuxt 4 + Capacitor 8. One codebase: the public marketing/state pages render on the server (SEO), the
signed-in app (`/app/**`, `/study/**`, `/account`, `/admin/**`) is client-only, and `nuxt generate` output is
what Capacitor packages. Every piece of learner state lives in Supabase; the device holds a cache + outbox.

```bash
pnpm --filter @rep/app content:manifest   # build server/assets/content/manifest.json + public/content/items.json from ../../content
pnpm --filter @rep/app dev                # http://localhost:3000
pnpm --filter @rep/app test               # vitest: SRS, coverage, readiness, repo LWW/outbox, device hash, events, routing
pnpm --filter @rep/app typecheck          # vue-tsc
pnpm --filter @rep/app generate && pnpm --filter @rep/app cap:sync   # native shells (after `npx cap add ios|android`)
```

## Layout

```
app/                Nuxt app dir (pages, components, composables, stores, layouts, assets)
  pages/**                  screens (WP-C): welcome, signin, app/** (home, study, mocks, review, glossary, account,
                            help, contact), admin/** (WP-D), public landing / states / pricing / methodology / legal
  layouts/mobile.vue        Capacitor shell · layouts/web.vue browser shell · layouts/admin.vue
                            both app shells are chrome-free on the session, and reach everything else
                            through AppPanel (see docs/DESIGN_SYSTEM.md "Structure")
  composables/              the contract in docs/V2_PLAN.md §6.1 (see below)
  middleware/auth.global.ts auth-first routing (public list in lib/state/routes.ts)
  plugins/layout.client.ts  default layout = mobile on native, web in a browser (page meta still wins)
  plugins/supabase.client.ts one supabase-js client (null in static dev mode)
  stores/settings.ts        LEGACY mirror of the server-backed settings; only `theme` lives here
lib/state/          server-authoritative repository (repo.ts) + cache adapters, device hash, events, routes, contracts
lib/study/          framework-free study logic: srs, coverage, readiness, plan, itemSource, sync (wire + LWW), api
lib/narration/      audio module (F6) — see docs/AUDIO_SPIKE.md
server/api/manifest.get.ts   serves the content manifest from Nitro server assets
scripts/build-content-manifest.ts
```

## Architecture (V2 — account-first, server is the source of truth)

**Modes** (`lib/study/mode.ts`, chosen at runtime from `NUXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY`):

| mode | when | items | learner state |
|---|---|---|---|
| `static` | no Supabase URL — **dev only** | `StaticItemSource` over `public/content/items.json` | Dexie only (the repo has no remote); nothing is gated |
| `free` | Supabase configured, signed out | none — only the public routes are reachable (`middleware/auth.global.ts`) | none |
| `api` | signed in | `ApiItemSource` → `issue-batch` signed batches under public ids, cached in Dexie `items` | Supabase rows via `lib/state/repo.ts`; Dexie is cache + outbox |

Free tier (40 questions in the home state + one short mock) is enforced **only server-side**, per account
and per device; `useFreeTier` shows what `issue-batch` / `free_tier_usage` report and never counts locally.

**Repository layer** (`lib/state/repo.ts`, one instance from `composables/useRepo.ts`):

- Reads come from the Dexie cache, which is hydrated on sign-in: `hydrate(uid)` wipes learner data if a
  different account used the device, pulls `study_state` (PostgREST under RLS), then calls `sync-progress`
  with `since = null` to pull every progress row and session. Clearing storage loses nothing; a new device
  shows the same progress.
- Writes go to the cache immediately and to the `outbox` table (kinds `progress`, `session`, `study_state`,
  `event`; one entry per key, newest wins). `useSync` replays it — debounced after every answer, on resume,
  on `online`, on sign-in — through `sync-progress` (progress + sessions, LWW by `client_updated_at`, the
  same rule the DB triggers apply) and a PostgREST upsert of `study_state` (LWW by `updated_at`).
  Entries are deleted only after the server accepted them and only if no newer write replaced them.
- Server rows strictly newer than the cache are merged back (`lib/study/sync.ts`), so two devices converge.
  A session left open elsewhere (`item_ids` on the row) becomes resumable here.
- `useStudyState` (settings + plan), `useStudy` (sessions, answers, SRS), `useReadiness` / `useCoverage` /
  `usePlan` (computed from the cached rows; recompute on every repo change) and `useFreeTier` all read and
  write through it. `stores/settings.ts` is a read-mirror kept for pages not yet rewritten; only `theme`
  is stored on the device.

**Device hash** (`lib/state/device.ts`, `composables/useDevice.ts`): sha256 of `rep:<platform>:<install id>[:<model>]`.
Native uses `@capacitor/device` `getId()` + model; web mints a random install id kept in **both** localStorage
and a 1-year cookie and restores from either. `callFunction` (`lib/study/api.ts`) adds it as `x-device-hash`
to every edge-function call; `register-device` also receives it as `fingerprint_hash` / `device_hash`.

**Events** (`lib/state/events.ts`, `composables/useEvents.ts`): `track(kind, props)` is synchronous and
offline-safe (Dexie outbox, kind `event`); `useSync` flushes batches of 50 to `track-event`. Emitted by the
composables: `app_open`, `sign_in`, `sign_out`, `answer`, `session_start`, `session_resume`, `mock_start`,
`mock_finish`, `settings_changed`, `help_search`, `ticket_created`, `review_submitted`, `coupon_redeemed`.

**Auth-first** (`composables/useAuth.ts`, `middleware/auth.global.ts`): email + 6-digit code only.
`auth.init()` restores the session and runs the signed-in hooks registered by `useBootstrap` (device hash →
`register-device` → entitlement + repo hydrate → free tier → RevenueCat identity → `app_open`) **before**
`auth.ready` flips, capped at 8 s, so no screen renders a free-tier or empty-progress state for a paid
learner. `verifyEmailCode` resolves only after the same hooks ran. Signed-out visitors may open only
`/`, `/pricing`, `/states/**`, `/methodology`, `/legal/**`, `/welcome`, `/signin`, `/help`, `/reviews`;
everything else redirects to `/welcome` (with `?next=`). On Capacitor `/` also goes to `/welcome`.

**Composable contract (V2 §6.1)** — what a screen calls:

| composable | use |
|---|---|
| `useAuth()` | `ready`, `user`, `signedIn`, `signInWithEmail(email)`, `verifyEmailCode(email, code)`, `signOut()`, `notice` |
| `useDevice()` | `hash`, `platform`, `ensure()` |
| `useEvents()` | `track(kind, props?)` |
| `useStudyState()` | `settings`, `set(patch)`, `plan`, `ready` |
| `useStudy()` | `startPractice(opts)`, `startMock(formId)`, `resume(sessionId?)`, `answer(choice)`, `next()`, `finish()`, `current`, `session`, `items`, `progressFor(itemId)`, `activeSession` |
| `useReadiness()` / `useCoverage()` / `usePlan()` | `national`/`state` readiness, coverage rows + `pipeline`, `plan` + `setExamDate` |
| `useFreeTier()` | `remaining`, `mocksRemaining`, `jurisdiction`, `exhausted`, `load()` |
| `useEntitlement()` | `isComplete`, `hasGuarantee`, `isAdmin`, `profile`, `load()`, `refresh()` |
| `useHelp()` | `search(q)`, `ask(q)`, `kb`, `sections` |
| `useSupport()` | `tickets`, `create(subject, body, category)`, `reply(ticketId, body)`, `load()` |
| `useReviews()` | `mine`, `submit(rating, body)`, `approved`, `loadApproved()` |
| `useCoupons()` | `redeem(code)` |
| `usePurchases()` | unchanged; `configure(uid)` is called from app.vue after sign-in, never from pages |

**Theme**: `data-theme` on `<html>`, system/light/dark (F12) — the one setting that stays on the device.

## Not yet wired
Payments / checkout (merchant of record + RevenueCat), narration UI (lib/narration exists),
glossary layer (F16), study plan tied to exam date (F20), tablet rotation checks (F14),
encrypted-at-rest item cache and TTL eviction (SPEC §5.4).

## Android release build

Prerequisites (this Mac, 2026-09-08): Homebrew `android-commandlinetools` (`sdkmanager`, `adb`), **JDK 21**
(`brew install openjdk@21`; Capacitor 8's Android library needs it — Java 17 fails with "invalid source release: 21"),
SDK platform 36 + build-tools 36 (`scripts/android-setup.sh sdk`, after `scripts/android-setup.sh licenses`).

```bash
scripts/android-setup.sh bundle   # content manifest → nuxt generate → cap sync → gradlew bundleRelease
# → apps/app/android/app/build/outputs/bundle/release/app-release.aab
```

Signing: `android/keystore/upload.jks` (git-ignored), alias `upload`, password `ANDROID_KEYSTORE_PASSWORD` in the
repo-root `.env`. Keep a backup of the keystore outside the repo — losing it means losing the ability to update the
app (or you must enrol in Play App Signing key reset). Package name `com.forsare.realestateprep` is fixed by the
first Play upload. Manifest carries the background-audio FGS (`mediaPlayback`) entries from docs/AUDIO_SPIKE.md;
declare that FGS type in Play Console → Policy → App content before production.
