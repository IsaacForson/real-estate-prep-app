# @rep/app — client (web + iOS + Android)

Nuxt 4 + Capacitor 8. One codebase: the marketing/state pages render on the server (SEO), the
study app under `/study` is client-only and offline-first, and `nuxt generate` output is what
Capacitor packages.

```bash
pnpm --filter @rep/app content:manifest   # build server/assets/content/manifest.json + public/content/items.json from ../../content
pnpm --filter @rep/app dev                # http://localhost:3000
pnpm --filter @rep/app test               # vitest: SRS, coverage, readiness
pnpm --filter @rep/app typecheck          # vue-tsc
pnpm --filter @rep/app generate && pnpm --filter @rep/app cap:sync   # native shells (after `npx cap add ios|android`)
```

## Layout

```
app/                Nuxt app dir (pages, components, composables, stores, layouts, assets)
  pages/index.vue           state picker with honest per-state status
  pages/states/[code].vue   exam-day brief (F18) rendered from content/states/<XX>.yaml
  pages/study/index.vue     dashboard: readiness (F5), pipeline (F10), coverage meter (F4)
  pages/study/practice.vue  question runner (F8 per-question persistence, F9 advances)
  pages/study/mock/*.vue    full-length timed mock in the state's exact format (F11)
  pages/study/review.vue    missed-question queue with citations (F17)
  pages/methodology.vue     the readiness method, in words that must match lib/study/readiness.ts
lib/study/          framework-free logic: srs.ts, coverage.ts, readiness.ts, db.ts (Dexie), itemSource.ts, mockBuild.ts
lib/narration/      audio module (F6) — see docs/AUDIO_SPIKE.md
server/api/manifest.get.ts   serves the content manifest from Nitro server assets
scripts/build-content-manifest.ts
fixtures/items.dev.yaml      8 original dev items so the loop can be exercised before the pipeline ships content
```

## Data flow

- **Content manifest** (states, blueprints, per-bank status) is generated from `content/` and served at `/api/manifest`.
- **Items**: dev/web preview reads `public/content/items.json` through `StaticItemSource`. Production
  uses `ApiItemSource` → `apps/api` `issue-batch` (signed, short-TTL batches of 50–200 items; the
  bank never ships whole — SPEC §5.4). Only the interface is wired today.
- **Progress** is one row per item in IndexedDB (Dexie), written on every answer, with
  `clientUpdatedAt` for last-write-wins sync to `apps/api` `sync-progress`.
- **Theme**: `data-theme` on `<html>`, system/light/dark (F12).

## Backend modes (lib/study/mode.ts)

Chosen at runtime from `NUXT_PUBLIC_SUPABASE_URL` / `NUXT_PUBLIC_SUPABASE_ANON_KEY` (both empty by default):

| mode | when | items | auth / sync |
|---|---|---|---|
| `static` | no Supabase URL — **dev only** | `StaticItemSource` over `public/content/items.json` (real ids, local bank) | none; no free-tier gate |
| `free` | Supabase configured, signed out | static free sample, gated to 40 questions / one state / one short mock (`FreeTierGate.vue`, kv `freeTier`) | none; local only |
| `api` | signed in | `ApiItemSource` → `issue-batch` signed batches under **public ids**, cached in Dexie `items`; rolling look-ahead of 30 unseen per bank | supabase-js session (magic link, Apple/Google); `register-device` on first sign-in; `sync-progress` debounced after each answer and on resume/online (lww by `clientUpdatedAt`, lib/study/sync.ts); `session_revoked` → signed out with "You signed in on another device." |

Composables: `useAuth`, `useEntitlement` (RLS read of `entitlements`, cached in kv), `useSync`, `useDevices`, `useFreeTier`, `useAppMode`. Page: `/account`.
The client never receives real item ids or the whole bank in `api` mode; the server enforces every limit the client displays.

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
