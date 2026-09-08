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

## Not yet wired
Auth, entitlement, device registry and sync (apps/api), narration UI (lib/narration exists),
glossary layer (F16), study plan tied to exam date (F20), tablet rotation checks (F14).
