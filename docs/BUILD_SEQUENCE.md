# Build Sequence — full-scope revision

**Supersedes SPEC.md §10.** Decision (Forson, 2026-09-08): the product ships all 50 states + DC.
There is no 3-state pilot. Phasing applies only to the *order* content is produced, never to
*scope*. Every jurisdiction is in the state map, the blueprint set, the pipeline config, and the
app from day one; a state whose bank is still in production is shown honestly as "in production"
inside the app, and the buyer already owns it.

## Targets

| Bank | Items | Notes |
|---|---|---|
| national_pearsonvue | ~900 | 80 scored exam items × ~11 bank items per exam item, per domain |
| national_psi | ~900 | PSI outline weighting, same ratio |
| state_XX × 51 | ~400 each → ~20,400 | Weighted by each state's published state-portion outline |
| **Total** | **≈ 22,200** | Plus ≥5 non-overlapping full-length mock forms per state |

## Phases

| Phase | Output | Gate to next |
|---|---|---|
| **0. Verify** | Payment rails (RevenueCat + Paddle/Lemon Squeezy as Forsare Ventures Ltd). 51-row state map from primary sources (`content/states/*.yaml`). Background-audio spike in the chosen client stack. Employment contract read. | Every row of the state map has `confidence: high` or a named unverified field with a reason. Payouts to a Ghanaian account confirmed. |
| **1. Engine** | `packages/schema`, `packages/content-lint` (CI), `packages/pipeline` (ingest → draft → verify → publish). Client shell: offline SQLite store, question runner, SRS, audio, dark mode. Pearson VUE national bank as pilot content for the *pipeline*, not the *product*. | Lint CI green on ≥900 national items; QA reviewer rejection rate < 20% after tuning (SPEC §11 kill criterion). |
| **2. All-state content** | Pipeline runs for every jurisdiction in parallel batches, largest candidate pools first (TX, CA, FL, NY, IL, GA, NC, OH, AZ, PA, WA, NJ, MI, …, WY). PSI national bank. Readiness score. 51 × 2 landing pages. | Each state reaches ≥400 verified items and 5 mock forms before it flips from "in production" to "complete" in-app. Launch does not wait for all 51 to flip. |
| **3. Launch + harden** | Entitlement + anti-sharing (SPEC §5). Pass guarantee. Founding price $39 → $59 once ≥ 25 states complete. | 150 sales in first 90 days across live states (kill criterion, adjusted from FL+TX+CA-only to all live states). |
| **4. Maintain** | Annual statute re-verification pass per state, driven by `last_verified`. p-value monitoring on every item. | Ongoing cost line, not a project. |
| **5. B2B** | School / brokerage seat licences. | Pass-rate evidence in hand. |

## Content production order (Phase 2)

Order is by estimated annual candidate volume so the biggest markets flip to "complete" first.
Volumes are ⚠ unverified until Phase 0 replaces them with ARELLO / commission figures.

1. TX, CA, FL
2. NY, IL, GA, NC, OH
3. AZ, PA, WA, NJ, MI, VA, TN, CO
4. MA, MD, MN, MO, SC, IN, WI, AL, LA, KY, OR, OK, UT, NV
5. CT, IA, AR, MS, KS, NM, NE, ID, HI, NH, ME, WV, RI, MT, DE, SD, ND, AK, VT, DC, WY

All 51 pipelines can run concurrently — the constraint is QA reviewer throughput, not the model.
Budget 2–3 recently licensed reviewers per state (SPEC §10), paid per batch.

## Where things stand — 2026-09-08 (late evening)

| Phase | Status |
|---|---|
| 0. Verify | State map 51/51 from primary sources. Audio: GO on Capacitor via `@mediagrid/capacitor-native-audio`; Groq TTS terms accepted, `pipeline audio-render` produces MP3 assets. Payment rails (Android): Play Console app on internal testing, three one-time products active, RevenueCat app + entitlements + offering + webhook configured; RevenueCat's Play credentials await Google's permission propagation. Web merchant of record not started. |
| 1. Engine | Pipeline complete incl. free-tier LLM router (`packages/llm`), direct draft/verify, distractor balancing, uniform key assignment, requeue, refs-audit, glossary, audio-render, QA packets. Client wired to Supabase in three modes (static / free tier / signed-in API) with sync, devices, entitlement; email-code sign-in; RevenueCat purchase flow on `/pricing` (native only). Backend deployed to Supabase (8 migrations, 7 edge functions, secrets incl. RevenueCat product map, sandbox allowed for testing). Signed Android bundles: versionCode 3 = 1.0.2 with Supabase + RevenueCat keys baked in. |
| 2. Content | Ground truth: 47 states grounded, 80% of 6,347 blueprint refs resolve (GA, NJ rules, IN, TN need a human download). **Pearson VUE national: 85 items approved after 100% in-house QA** (46% yield of 184 pilot drafts; 20% QA rejection, mostly classes now caught by lint). Full remaining PV draft running on NVIDIA Nemotron (55/207 requests done, ~1 request per 2–3 min; faster after the Groq daily reset). PSI and 51 states follow. |
| 3–5 | Not started (web checkout via merchant of record, iOS shell, Play production review incl. password reviewer account, R8). |

Blockers needing Forson: (a) custom SMTP for Supabase Auth (Resend or Brevo) — the default mailer allows 2 emails/hour and the free tier cannot edit the email template, so the 6-digit code does not appear in emails until SMTP is configured; (b) Play payments-profile country (Ghana eligibility); (c) GA/NJ/IN/TN statute downloads; (d) Google/Apple OAuth client ids (optional).

Next actions, in order: (1) finish PV (review the full-run output), then PSI, then states in the docs/BUILD_SEQUENCE order — each 100%-reviewed before publish; (2) sandbox purchase test on a phone once RevenueCat credentials validate; (3) device day for audio; (4) mock forms + per-state landing pages once state banks exist; (5) web checkout via merchant of record.

## V2 (started 2026-09-09) — see docs/V2_PLAN.md
Account-first product, server-authoritative learner state with device tracking, Tailwind mobile UI distinct from the web landing site, admin console (Forson only), help center + tickets, reviews, coupons, nightly source watch + remote publish. All five work packages landed and were deployed on 2026-09-09 (migrations 0010–0014, 15 functions, 118 items published to the content bucket, Android 1.1.0 / versionCode 5). Remaining: Forson adds GitHub secrets for the nightly workflow; phone test of sign-in + sandbox purchase; reviewer password account before production.
