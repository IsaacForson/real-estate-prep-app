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

## Where things stand — 2026-09-08

| Phase | Status |
|---|---|
| 0. Verify | State map: **51/51 from primary sources**, 0 lint errors (`pnpm state-map`). Audio spike: GO with `@mediagrid/capacitor-native-audio`; device checklist pending. Payment rails (RevenueCat / Paddle / Lemon Squeezy as Forsare Ventures Ltd) and the Heatmap contract read are **still to do by Forson** — nothing here can verify them. |
| 1. Engine | Schema, lint CI, pipeline (ingest → draft → verify → QA → publish → mocks → status → refs-audit) built and tested, dry-runs for both national banks assemble end to end (Pearson VUE 121 requests / 968 items; PSI 114 / 912). Client shell (`apps/app`): state pages, dashboard with readiness + coverage + plan, question runner with per-question persistence and resume, timed mock, missed queue, narration bar, dark mode — smoke-tested in the browser. Backend (`apps/api`) schema + edge functions: in progress. **No API credit has been spent; no items drafted yet.** |
| 2. All-state content | Blueprints: **51/51** state + 2 national. Ground truth cached for 31 states (≥50% refs resolve) + 21 national authorities (12 federal statutes, 9 authored reference notes). 20 states need a manual statute download — checklist in docs/STATUTE_GAPS.md. |
| 3–5 | Not started. |

Next actions, in order: (1) run `pnpm pipeline draft national_pearsonvue` for real and tune prompts on
the first batch (≈ $25–40 per national bank at Batches pricing); (2) hire 2–3 licensed reviewers and
run the QA sheet on the first 100 verified items — the 20% rejection kill-criterion is measured here;
(3) work through docs/STATUTE_GAPS.md; (4) device-day for audio; (5) payment rails.
