# @rep/api — Supabase backend

Postgres schema + row level security + Deno edge functions for the exam-prep client. Implements
SPEC §5 (anti-sharing / entitlement), §6 (free tier vs. Complete), §7 (payments through a
merchant of record and RevenueCat — never Stripe) and §8 (Supabase as the small backend).

The database holds **identity, entitlement, devices, progress and statistics**. It holds **no
item text**. Items are delivered as signed, short-lived batches built from the content bucket
(SPEC §5.4); this repo's `content/` tree is the source of truth and the pipeline publishes it.

```
apps/api/
  deno.json                  root config: `deno task check|test|lint|fmt` across all functions
  package.json               pnpm scripts that shell out to the supabase cli + deno
  scripts/typecheck.mjs      `pnpm -r typecheck` shim: runs `deno check` when deno is installed
  supabase/
    config.toml              local stack config (ports, auth, storage bucket, per-function verify_jwt)
    seed.sql                 local-only placeholder item_index rows + canary pool
    .env.example             secrets the functions need (copy to supabase/.env.local)
    migrations/
      0001_init.sql          enums, domains, helpers, audit_log
      0002_profiles.sql      profiles (home state, exam date, sharing_notice_ack, current_session_id)
      0003_entitlements.sql  entitlements, webhook_events, grant/revoke/transfer functions
      0004_devices_sessions.sql  devices (3 slots, 7-day cooldown), sessions (single live), fn_register_device …
      0005_item_delivery.sql item_index (ids only), item_id_aliases, canary_items, item_batches, rate_limits
      0006_progress.sql      progress (lww), item_stats (trigger), study_sessions, fn_record_answer(s), fn_readiness_inputs
      0007_anomaly.sql       geo_events, anomaly_flags, email_outbox, fn_open_anomaly_flag
    functions/
      _shared/               auth, db, hmac, response, limits, pure rule modules (+ tests)
      issue-batch/           signed item batches, srs-due first, look-ahead by blueprint node
      sync-progress/         two-way lww sync + anomaly heuristics + re-verification email
      register-device/       3-device rule, starts the single live session
      remove-device/         self-service removal with 7-day cooldown
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
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"fingerprint_hash\":\"$FP\",\"platform\":\"web\",\"name\":\"laptop\"}"
# → { device_id, session_id, ... }

curl -s http://127.0.0.1:54321/functions/v1/issue-batch \
  -H "Authorization: Bearer $TOKEN" -H "x-device-id: $DEVICE" -H "x-session-id: $SESSION" \
  -H 'content-type: application/json' \
  -d '{"bank":"national_pearsonvue","jurisdiction":"FL","size":50}'
```

A fresh account is on the free tier: set `profiles.home_jurisdiction` first (the client does this
during onboarding; locally `update profiles set home_jurisdiction = 'FL' where id = '<uid>'`).
To unlock everything locally run, as postgres in the SQL editor:
`select fn_grant_entitlement('<uid>', 'complete', 'manual', null, null, '{"note":"dev"}');`

Checks that run without Supabase:

```bash
pnpm check     # deno check on every function entrypoint and test
pnpm test      # deno test — pure rule modules (device rule, lww, anomaly, batch mix, hmac, webhook verify)
pnpm lint      # deno lint
pnpm typecheck # what `pnpm -r typecheck` at the repo root runs; no-op with a warning if deno is missing
pnpm db:smoke  # migrations + seed + scripts/pg-smoke.sql on a throwaway local postgres (needs initdb/psql, not docker)
```

`db:smoke` stands in the `auth` schema with `scripts/pg-shim.sql` and then drives the rules the
way PostgREST would (`set role` + `request.jwt.claims`): 3-device limit, cooldown, single
session, idempotent grants, aliasing, lww, `item_stats` deltas, RLS denials, anomaly dedupe.

## Environment variables

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected by the edge runtime.
Everything else lives in `supabase/.env.local` locally and `supabase secrets set` when hosted —
see `supabase/.env.example` for the full annotated list.

| var | used by | purpose |
|---|---|---|
| `BATCH_SIGNING_SECRET` | issue-batch | HMAC key for batch signatures (SPEC §5.4) |
| `BATCH_TTL_SECONDS` | issue-batch | batch validity, default 21600 |
| `BATCH_BUCKET` | issue-batch | private storage bucket for per-batch json, default `batches` |
| `PADDLE_WEBHOOK_SECRET`, `PADDLE_PRICE_ID_COMPLETE`, `PADDLE_PRICE_ID_PASS_GUARANTEE` | webhook-paddle | signature secret + price → product map |
| `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_VARIANT_ID_*` | webhook-lemonsqueezy | signing secret + variant → product map |
| `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_PRODUCT_ID_*`, `REVENUECAT_ALLOW_SANDBOX` | webhook-revenuecat | auth header value, optional hmac secret, product map |
| `IP_HASH_SALT` | all user functions | salt for hashed ips in `audit_log` |

## How the client talks to it

1. **Auth** — supabase-js as usual (email / magic link / oauth). Long-lived refresh tokens; the
   study path never re-prompts (F13).
2. **Device + session** — after sign-in, `POST register-device` with a sha256 fingerprint of a
   stable install id. The response carries `device_id` and `session_id`; send them as
   `x-device-id` / `x-session-id` on every later call. A sign-in elsewhere revokes this session
   and the next call returns `401 session_revoked` with a plain-language message (SPEC §5.3).
   `409 device_limit` lists the active devices so the UI can offer removal (`POST remove-device`;
   the slot stays busy for 7 days).
3. **Items** — `POST issue-batch` with `{ bank, jurisdiction, kind, size, nodes?, form_id? }`.
   You get **public ids** (per-user aliases; real item ids never leave the server), a signed
   `content_url` for the batch json, an `expires_at`, and the HMAC `signature`. Cache the batch
   encrypted at rest; re-request after expiry. Free tier: 40 items total, home state only, one
   `short` mock (`402 free_tier_exhausted`, `403 free_tier_*`). `429 rate_limited` above the
   hourly human ceiling.
4. **Progress** — the client owns the red/yellow/green scheduler offline (F7, F10) and pushes
   `progress` rows keyed by public id plus resumable `study_sessions` (position + answers, F8) to
   `POST sync-progress`, with `client_updated_at` on every row. The server merges last-write-wins,
   updates bank-wide `item_stats`, and returns rows newer than your `since` watermark so a new
   device catches up. If a SPEC §5.3 heuristic trips, the response says
   `reverification_requested: true` and an email is queued — never a lockout.
5. **Direct reads** — RLS lets the signed-in user `select` their own `profiles`, `entitlements`,
   `v_my_devices`, `v_my_batches`, `progress`, `study_sessions`, `anomaly_flags`, `audit_log`, and
   call `fn_readiness_inputs(uid, jurisdiction)` for the readiness score inputs per blueprint
   node. Direct `progress` / `study_sessions` writes are also allowed and go through the same
   lww trigger, but prefer `sync-progress` so the anomaly checks run.
6. **Honest UX flag** — `profiles.sharing_notice_ack` records that the user saw *"Your readiness
   score assumes one person is answering. Sharing this account will make it inaccurate."* The
   client may update it directly; `issue-batch` echoes it so the notice can be shown until acked.

## Schema at a glance

Every table: uuid pk (or natural composite), `created_at timestamptz default now()`, RLS enabled.
Users only ever see `user_id = auth.uid()`. Tables marked *service* have no client policies.

| table | key rule |
|---|---|
| `profiles` | one per auth user (trigger). `current_session_id` + `last_reverified_at` are server-owned (trigger reverts client edits). |
| `entitlements` | `complete` / `pass_guarantee`; live = `revoked_at is null`. Unique on `(source, external_id, product)` → idempotent grants. Written only by `fn_grant_entitlement` / `fn_revoke_entitlement` / `fn_transfer_entitlements` (service). |
| `webhook_events` *(service)* | unique `(provider, event_id)`; a failed attempt leaves `processed_at` null so the provider retry is reprocessed. |
| `devices` | unique `(user_id, fingerprint_hash)`. `fn_active_device_count` counts active **plus removed-in-cooldown**; `fn_can_register_device` < 3; `fn_register_device` is advisory-locked per user and raises `P0003 device_limit`; `fn_remove_device` sets `cooldown_until = now() + 7 days`. |
| `sessions` | one live row per account: `fn_start_session` revokes the rest (`superseded`) and sets `profiles.current_session_id`; `fn_session_is_valid(uid, session, device)`. |
| `item_index` *(service)* | published item **ids + metadata only** (bank, node, level, status, `is_canary`). Written by the pipeline's publish step. |
| `item_id_aliases` *(service)* | per-user `public_id ↔ item_id`; `fn_alias_items`, `fn_resolve_public_ids`. |
| `canary_items` *(service)* | which uniquely-worded variants each account received; `fn_ensure_canaries` prefers least-shared variants. |
| `item_batches` | 1–200 ids, `expires_at`, HMAC `signature`; owner reads via `v_my_batches` (public ids only). |
| `rate_limits` *(service)* | fixed windows; `fn_rate_limit_hit(key, limit, window, cost)`. |
| `progress` | pk `(user_id, item_id)`; before-write trigger drops stale rows (lww on `client_updated_at`) and sets `leech = misses >= 4`; after-write trigger adds the delta to `item_stats`. |
| `item_stats` *(service)* | attempts / correct per item; `v_item_pvalues` flags ≥95 % or <25 % with n ≥ 30 (SPEC §3.5 step 7). |
| `study_sessions` | client-generated uuid, `position`, `answers jsonb`, `time_remaining_s`; lww trigger; `user_id` pinned on update. |
| `geo_events` *(service)* | coarse `region_key` per request, never an ip. |
| `anomaly_flags` | `devices_30d` / `geo_24h` / `answer_velocity`; `fn_open_anomaly_flag` dedupes per kind per 7 days and queues the email; `fn_resolve_anomaly_flags` when the link is clicked. |
| `email_outbox` *(service)* | queued transactional mail; send is a stub (`_shared/email.ts`). |
| `audit_log` | append-only via `fn_audit`; owner-readable, so it never mentions canaries. |

Key functions: `fn_active_device_count`, `fn_can_register_device`, `fn_register_device`,
`fn_remove_device`, `fn_start_session`, `fn_session_is_valid`, `fn_record_answer` /
`fn_record_answers` (progress + item_stats atomically, by public id), `fn_progress_since`,
`fn_batch_candidates`, `fn_readiness_inputs`, `fn_rate_limit_hit`, `fn_open_anomaly_flag`,
`fn_grant_entitlement`, `fn_revoke_entitlement`, `fn_transfer_entitlements`.

Numbers live in one place per side: `functions/_shared/limits.ts` and the comments in
`migrations/0004_devices_sessions.sql`. Keep them in sync.

## Payments: what is deliberately NOT here

- **No Stripe.** Stripe does not onboard sellers in Ghana (SPEC §7). Web checkout is hosted by a
  merchant of record — Paddle or Lemon Squeezy — who is the legal seller and handles tax. Our
  side is only the webhook that grants the entitlement. Pass the Supabase user id as
  `custom_data.user_id` (Paddle) / `checkout[custom][user_id]` (Lemon Squeezy) so the grant
  matches; email is the fallback (`fn_user_id_by_email`), otherwise the event is stored as
  `unmatched_user` for support.
- **No StoreKit / Play Billing code.** Mobile goes through RevenueCat; the client calls
  `Purchases.logIn(<supabase uid>)` before purchasing and RevenueCat's webhook grants here.
  Store `TRANSFER` events move entitlements; `CANCELLATION` with `cancel_reason =
  CUSTOMER_SUPPORT` is the refund signal for non-subscription products.
- **Disable Family Sharing** on both non-consumable products in App Store Connect (SPEC §5.3).
  That is a store setting, not code — ⚠ verify current App Store policy before launch.
- **No checkout UI, receipts, invoices or tax logic.** The merchant of record owns them.
- **No item text, audio or mock form definitions.** They ship from the content bucket;
  `_shared/content-store.ts` has the interface and a TODO stub that uploads a placeholder batch
  document so the flow runs end to end locally.
- **No email provider.** Re-verification mail is queued in `email_outbox`; sending is a stub.
- **No cron.** `rate_limits` garbage-collects opportunistically; add pg_cron for that and for
  draining `email_outbox`.

## Verification notes (2026-09-08)

- Import style: `npm:@supabase/supabase-js@2.116.0` via per-function `deno.json`, `Deno.serve`
  entrypoints. Supabase's docs now also show a `withSupabase` wrapper from `npm:@supabase/server`
  (`export default { fetch }`); both run on the edge runtime. This code uses the explicit client
  so it can be `deno check`ed without the runtime. Migrating to `withSupabase` is mechanical.
- Paddle: `Paddle-Signature: ts=…;h1=…`, HMAC-SHA256 over `ts:body`, hex — confirmed in the
  Paddle docs. Tolerance here is 300 s (Paddle SDKs default to 5 s).
- Lemon Squeezy: `X-Signature`, HMAC-SHA256 hex of the raw body — confirmed from the
  open-source `lmsqueezy/laravel` middleware; docs.lemonsqueezy.com refused automated fetches, so
  re-read the "Signing requests" page once by hand. Payloads carry no event id;
  `<event_name>:<order_id>` is the idempotency key.
- RevenueCat: `Authorization` header compare plus optional `X-RevenueCat-Webhook-Signature:
  t=…,v1=…` over `t.body` — confirmed in the RevenueCat docs.
- Geo headers (`cf-ipcountry` etc.) depend on what fronts the hosted edge runtime; unknown →
  the heuristic ignores the request. Log `req.headers` once on the hosted project to confirm.
- SQL was executed end to end on vanilla Postgres 16 with a stand-in `auth` schema
  (`pnpm db:smoke`); `supabase db reset` against the real stack has not been run here, so
  Supabase-specific defaults (grants on `public`, `auth.users` columns) are still worth one
  local run.

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
