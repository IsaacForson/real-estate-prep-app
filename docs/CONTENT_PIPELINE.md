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
