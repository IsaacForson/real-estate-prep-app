# Content pipeline

Implements SPEC §3.5. Every step is a CLI command in `packages/pipeline`; every gate is a file
move, so the state of any item is visible in the filesystem and in git.

```
content/statutes/<JUR>/         ← 1 INGEST     ground truth (statute / rule / federal law text)
        │
        ▼  pipeline draft <bank>        (Message Batches API, 50% off, claude-opus-5)
.pipeline/drafts/<bank>/*.yaml  ← 2 DRAFT      status: draft
        │
        ▼  pipeline verify <bank>
        │    3a local: quoted_text found verbatim in cached statute + per-item lint rules
        │    3b model: independent verifier sees STATUTE TEXT + item → pass/fail (batched)
        ├── fail → .pipeline/rejected/<bank>/*.yaml   (reasons attached; never deleted)
        ▼
content/items/<bank>/<domain>/  ← 3 VERIFIED   status: verified   (CI lint runs on every merge — §3.6)
        │
        ▼  pipeline qa-sheet <bank> --sample 0.2 → CSV to a licensed reviewer
        ▼  pipeline qa-approve <reviewer> <ids…> / qa-reject <reviewer> <id> "<reason>"
                                ← 5 HUMAN QA   status: qa_approved
        ▼  pipeline publish <bank>
                                ← 6 PUBLISH    status: published
        ▼  (app telemetry) per-item p-value; <25% or >95% correct → re-review
                                ← 7 MONITOR
```

## 1. Ingest ground truth

The pipeline refuses to draft a bank with no cached statute text for its jurisdiction. This is
the whole defensibility argument (SPEC §3.5): correctness comes from the citation chain, not from
anyone's real estate knowledge.

```bash
pnpm pipeline ingest TX "Tex. Occ. Code ch. 1101" "https://statutes.capitol.texas.gov/Docs/OC/htm/OC.1101.htm" "Real Estate Brokers and Sales Agents"
pnpm pipeline ingest FL "Fla. Stat. § 475.25" --file /path/to/475.25.txt "Discipline"   # PDF/JS-rendered sources: extract text first
pnpm pipeline statutes TX
```

Files land in `content/statutes/<JUR>/<slug>.md` with a small front-matter header (citation,
url, fetched_on). Statutes and regulations are government edicts and not copyrightable; the text
is committed so verification is reproducible offline.

**National banks (`JUR = NAT`).** Law-based nodes (fair housing, RESPA, TILA/Reg Z, ECOA, CERCLA,
lead paint) ingest federal statute and CFR text. Non-statutory nodes (appraisal approaches,
contract elements, math) are grounded in *authored reference notes* saved through the same
`ingest --file` path with citations of the form `REP Ref. Appraisal § 3`. Reference notes are
written by us from public-domain sources, reviewed like items, and versioned in the same
directory. An item may cite either kind of document; the verifier treats both identically.

Every ingested document should be re-fetched at least annually; the `fetched_on` date is what the
annual re-verification pass (SPEC §11) keys on.

### How references find text (`packages/pipeline/src/cite.ts`)

A blueprint node's `statute_refs` are matched to cached documents by citation root, with ranges
and aliases: `"Tex. Occ. Code § 1101.652(b)"` finds the doc cited `Tex. Occ. Code ch. 1101`;
`"15 U.S.C. § 1635"` or `"TILA § 1635"` finds `15 U.S.C. §§ 1601–1667f (TILA)`;
`"REP Ref. Contracts § 2.3"` finds the reference note. A ref more specific than the doc root is
**sliced** to that section (heading heuristics cover govinfo, Texas/Florida-style codes, rule
numbers and our `### § n.n` notes), so a node about rescission ships § 1635, not 388K characters
of TILA. Doc-level refs ship the whole document. A node whose refs match nothing fails loudly;
a node with no refs cannot be drafted at all. Total authority text per node is capped
(`DRAFT_MAX_STATUTE_CHARS`, default 400K ≈ 100K tokens) and cached across that node's calls.

`pnpm pipeline refs-audit [XX] [--verbose]` resolves every blueprint node's refs against the cache
and reports matched / sliced / whole-document / unmatched counts and any node over the size cap.
Run it after ingesting a state's law and before its first draft; `--verbose` lists the unmatched
refs so you can see whether the gap is an uncached authority or a citation-form mismatch.

Keep U.S. Code doc citations as ranges (`§§ 1–7`), never `§ 1 et seq.`, so `§ 1` reads as a section.

## 2. Draft

```bash
pnpm pipeline plan national_pearsonvue          # gaps per blueprint node
pnpm pipeline draft national_pearsonvue          # submits one batch for all gaps
pnpm pipeline draft state_TX --nodes 1.1,1.2 --limit 16
pnpm pipeline batches                             # anthropic backend only
pnpm pipeline collect <batchId>                  # anthropic backend only (router writes drafts immediately)
```

Each batch request drafts 8 items for one node. The request carries the drafting system prompt
(cached), the node's statute text (cached), the node label, its share of the real exam, the
cognitive mix, and the existing stems for that node so duplicates are avoided at the source. The
model returns JSON validated against `DraftItem` in `@rep/schema` via structured outputs.

`--dry-run` writes the fully assembled batch requests to `.pipeline/dry-run/` without calling the
API — use it to check which authorities a node pulls and how many tokens it costs before spending.

Cognitive mix defaults to 30% knowledge / 50% application / 20% analysis unless the blueprint
publishes a per-domain split (Pearson VUE does). Bank sizing is 11 bank items per scored exam item.

**Backend.** `LLM_BACKEND=router` (default) drafts and verifies immediately through
`packages/llm` — free-tier providers in the order set by `LLM_PROVIDER_ORDER` (Groq → Cerebras →
Mistral → DeepSeek → NVIDIA with key rotation). Authority text is chunked (`DRAFT_CHUNK_CHARS`,
default 18K ≈ 5K tokens; `DRAFT_ITEMS_PER_CHUNK`, default 4) and requests run `LLM_CONCURRENCY`-wide.
Providers that answer 402/401 are disabled for the run; 429s rotate keys and cool down.
`LLM_BACKEND=anthropic` uses `claude-opus-5` through the Message Batches API instead (50% off,
prompt caching) — the original design, kept for when there is budget. See docs/DECISIONS.md.

## 3. Verify

```bash
pnpm pipeline verify national_pearsonvue         # 3a locally, then submits the 3b batch
pnpm pipeline collect-verify <batchId>
```

3a is deterministic and runs offline. It also requires `citation.source` to name a section and to
correspond to the document that actually contains the quote. 3b then sends the verifier **only the
enclosing section of that document** (located from the quote), so the verifier cannot be rescued
by unrelated text and each verification costs a few thousand tokens. 3b is adversarial by design: the verifier is told to assume
the item is wrong, must locate the quoted text, must check that *no* distractor is also
defensible under the text, and must confirm the citation names the exact subsection. Items that
fail keep their reasons in `.pipeline/rejected/` so prompt tuning can be measured.

**Kill criterion (SPEC §11):** if licensed reviewers reject more than 20% of items that survived
3b after prompt tuning, the approach is not working. Track it per bank from the QA sheets.

## 4. Lint (CI)

`pnpm lint:content` runs on every push touching `content/` or `packages/`. It validates every
state record, blueprint and item against the schemas, cross-checks each item's blueprint node,
and applies the §3.6 rules:

| Rule | Severity | Threshold |
|---|---|---|
| key is the longest option | error | > 25% of a domain's items |
| all/none/both of the above | error | any |
| option length balance | error | any option ±30% from mean |
| option grammatical form (punctuation, case, opening) | warn | inconsistency |
| absolute qualifiers in a subset of options | error | any |
| negative stem without bold negation | error | any |
| key position distribution | error | any position < 15% or > 35% of a domain (n ≥ 20) |
| missing citation / quote / explanation | error | any |
| duplicate or near-duplicate stem (3-gram Jaccard) | error | ≥ 0.6 |
| numeric stem without worked solution | error | any |

A failing item cannot merge.

## 5–6. Human QA and publish

```bash
pnpm pipeline qa-sheet state_TX --sample 0.2     # random sample, CSV in .pipeline/qa/
pnpm pipeline qa-approve reviewer_tx_01 TX-1101-0007 TX-1101-0008
pnpm pipeline qa-reject  reviewer_tx_01 TX-1101-0009 "1101.652(b)(1) was amended in 2025; fee is now $X"
pnpm pipeline publish state_TX
```

Reviewers are recently licensed agents paid per batch (SPEC §10). The sample is random per
sheet, never the first N. A rejection retires the item and records who and why.

## Mock forms (F11)

```bash
pnpm pipeline mock-build TX --forms 5              # published items only
pnpm pipeline mock-build TX --forms 5 --status verified   # pre-QA preview
```

Builds N non-overlapping full-length forms in the state's exact format: the national section is
drawn from the state's routed national bank with the state record's national item count and the
national blueprint's weights (largest-remainder apportionment), the state section from the state
blueprint. If any node cannot supply `per-form count × forms` items the command prints the
shortfall per node and writes nothing — that report is the per-state "ready" gate. Forms land in
`content/mocks/<XX>/form-NN.yaml` as lists of item ids plus time and pass rules.

## Item identity

`<JUR>-<ROOT>-<NNNN>` — `FL-475-0413`, `TX-1101-0007`, `NAT-PV-IV-0012`, `NAT-PSI-V-0102`.
IDs are permanent. Edits bump `version`. Retired items are moved, never renumbered. Per-user ID
rotation for anti-scraping (SPEC §5.4) happens in the delivery layer, not in content.

## 7. Source watch (content freshness)

```bash
pnpm pipeline watch-sources                       # every cached authority with a URL
pnpm pipeline watch-sources --bank state_TX       # one jurisdiction
pnpm pipeline watch-sources --dry-run             # report only; touches no content/docs
pnpm pipeline watch-sources --skip-blocked        # do not even try hosts known to block scripts
```

Runs nightly (§8). For each distinct source URL in `content/statutes/**` front-matter the command
re-fetches with the same strategy as `ingest` (HTML → text, PDF → text, govinfo notes stripped),
whitespace-normalises, and compares a sha256 to the doc's `source_sha256`:

| Outcome | What happens |
|---|---|
| no stored hash | first sight: `source_sha256`, `text_sha256` (hash of the cached text) and `checked_on` are written to the front-matter. Nothing is flagged. |
| same hash | `checked_on` bumped |
| different hash | fetched text saved as `content/statutes/<JUR>/_versions/<slug>/<date>.md`; the cached doc's text is **not** replaced (it may be a curated slice or OCR, and it is what the live items were verified against) but its `source_sha256` / `source_changed_on` are updated so the same change is not re-flagged tomorrow. Every item of that jurisdiction whose `citation.source` matches the doc or whose quote is found in it is re-checked against the new text: quote no longer verbatim, or the cited section (sliced via `cite.ts`, exactly what the verifier saw) reads differently → `status: needs_review` + `review_reason`. A dated section is appended to `docs/STATUTE_CHANGES.md`. |
| fetch fails / JS shell / archive (.zip) | skipped with a note. Hosts in `KNOWN_BLOCKED_HOSTS` (watch.ts, from docs/STATUTE_GAPS.md) never raise an alert; an unexpected failure raises `fetch_failed`. |

Fetches run `--concurrency` wide (default 6) with a per-URL timeout of `WATCH_TIMEOUT_MS` (default
30 s; the nightly job uses 60 s because some compiled law books are 10–30 MB PDFs). Each distinct URL
is fetched once even when several cached docs share it.

Outputs: `.pipeline/watch/<date>.json` (full report, `.dry-run.json` for dry runs) and
`.pipeline/watch/alerts.json` — rows `{ kind: source_changed | quote_broken | fetch_failed,
jurisdiction, ref, detail }` that `publish --remote` inserts into `content_alerts` for the admin
console, then renames to `alerts.<ts>.sent.json`.

`needs_review` items are dropped from `content:manifest`, from `publish --remote` (their `item_index`
row is set to `retired` so the API stops serving them) and from mocks until a reviewer re-approves:
re-ingest the authority if the change is real, re-run `verify`/`qa-approve` or `qa-reject`, and
clear `review_reason`. Several cached docs may share one URL (a compiled law book split into
chapters); the hash is of the whole publication, so a change anywhere in the book flags all of them
— the per-item check then narrows it to the items whose section actually moved.

## 8. Remote publish and the nightly workflow

```bash
pnpm pipeline publish --remote                    # all qa_approved + published items
pnpm pipeline publish --remote state_TX --dry-run # plan only, no network, no credentials needed
pnpm pipeline publish --remote --force-version    # write a content_versions row even if nothing changed
```

Needs `SUPABASE_URL` (or `NUXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY` in the
environment or the repo-root `.env` (read through `process.env`; values are never logged). What it
writes, using the Storage REST API and PostgREST directly:

| Target | Content |
|---|---|
| bucket `content`, object `items/<bank>/<item_id>.json` | the full Item as JSON — options in stored order, `key` retained; the API's `content-store.buildBatch` strips reviewer/provenance before delivery |
| table `item_index` (upsert on `item_id`) | `item_id, bank, jurisdiction, blueprint_node, cognitive_level, license_level, status, content_version` — `status` is `published` for both `qa_approved` and `published` items (the table's check constraint only allows published/retired), `content_version` = the item's `version` |
| table `content_versions` (insert) | `version = <ISO date>+<short git sha>`, `published_at`, `item_count` (live objects), `notes` — only when something was uploaded or retired; the app polls this table daily to refresh its cache |
| table `content_alerts` (insert) | rows from `.pipeline/watch/alerts.json` with `status: open` |

Idempotent: `.pipeline/publish/remote-manifest.json` stores the sha256 of every uploaded object;
unchanged items are skipped, edited items re-uploaded, and items that left the publishable set
(retired, pulled to `needs_review`, deleted) get `status: retired` in `item_index`. The manifest is
updated per successful upload, so an interrupted run resumes where it stopped. A missing
`content_versions` / `content_alerts` table (WP-A migration not applied yet) is a warning, not a
failure; alerts stay on disk until they can be sent.

**Nightly workflow** — `.github/workflows/content-nightly.yml`, cron `0 3 * * *` (03:00 UTC) and
manual dispatch (with a `skip_publish` switch): checkout `main` → `pnpm install` → `watch-sources`
→ `status --md docs/STATUS.md` → `help:kb` → commit `content/`, `docs/` and `help.json` back to
`main` as "content: nightly source watch" (skipped when nothing changed) → upload the watch report
as a build artifact → `publish --remote`. The publish manifest is carried between runs with
`actions/cache` (key `remote-manifest-<run id>`, prefix restore); if the cache is lost the run
simply re-uploads everything, which is safe.

Required repository secrets (Settings → Secrets and variables → Actions):

| Secret | Used by | Where to find it |
|---|---|---|
| `SUPABASE_URL` | `publish --remote` | Supabase project → Settings → API → Project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | `publish --remote` | Supabase project → Settings → API → service_role key (`sb_secret_…`). Server-only; never ship it in the app. |

The workflow needs `contents: write` (declared in the file) to push the nightly commit. No other
secrets are involved: the LLM router keys are not needed because the nightly job never drafts.

## 9. Help Center knowledge base

```bash
pnpm --filter @rep/app help:kb        # → apps/app/public/content/help.json
```

`apps/app/scripts/build-help-kb.ts` assembles the in-app Help Center from the repo so it cannot
drift from the product rules: `docs/HELP_FAQ.md` (hand-written; one `## ` section per article with
`category:` / `keywords:` lines), curated lines of SPEC.md §5.2–5.3 and §6 (one-person rule,
3-device rule, pricing / free tier / guarantee), QA_PROCESS.md, QA_REVIEWER_GUIDE.md and
CONTENT_PIPELINE.md §1/§3 (how questions are verified), `app/pages/methodology.vue` (readiness
score) and `app/pages/legal/*.vue` (tags stripped). Output shape
`{ generated, articles: [{ id, title, category, body_md, keywords[], source }], index: { keyword: [ids] } }`;
at most 60 articles, each at most 250 words (longer sections become numbered parts). The script
fails if a limit is exceeded. The `index` is a plain keyword → article-id map for client-side search;
`help-ai` grounds its answers on the same articles.
