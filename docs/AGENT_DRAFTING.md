# Agent drafting (provisional content) — 2026-09-09

Forson's decision: populate every bank now. Claude agents write items directly against the cached authority
text; `import-drafts` enforces the verbatim-quote and lint gates; `verify-local` publishes them as
`verified` (provisional, `review_reason` set). The model verifier and human QA continue in the background
and retire what they reject. `PUBLISH_INCLUDE_VERIFIED=1 pipeline publish --remote` ships them.

## Loop per bank
1. `pnpm --silent pipeline node-brief <bank>` → `.pipeline/briefs/<bank>/<node>.md` (gap, cognitive mix,
   existing stems, covered answers, authority text with non-examinable sections stripped).
2. Write `.pipeline/agent/<bank>/<node>-<n>.json`: `[{ "node": "<node id>", "items": [ ...DraftItem ] }]`.
3. `pnpm --silent pipeline import-drafts <bank> <file>` → prints written ids and `REFUSED` entries with reasons.
   Fix refused items in a new file and re-import. Never lower the bar to get an item through.
4. When the node gap is filled: `pnpm --silent pipeline verify-local <bank>`, then `pnpm --silent pipeline keys <bank>`.
5. `PUBLISH_INCLUDE_VERIFIED=1 pnpm --silent pipeline publish --remote` (orchestrator runs this) and
   `pnpm --silent pipeline forms-build <bank|XX> --remote` once a bank has ≥ 100 items.

## Item rules (what the gates check)
- `citation.quoted_text`: copied **verbatim** from the authority text in the brief (≥ 20 chars, one or two
  sentences, no ellipses, no paraphrase). `citation.source`: the section that contains the quote, in the
  document's own citation style shown in the brief headings (e.g. `42 U.S.C. § 3604(a)`, `Fla. Stat. § 475.25(1)(b)`,
  `REP Ref. Contracts — Statute of frauds`). Never cite study-note numbering like `§7.2`.
- One correct option, three plausible wrong ones; options in the same grammatical form; numerically distinct;
  no "all/none of the above"; no absolutes (always/never); the key must **not** be the single longest option —
  keep all four within about ±30 % of each other's length.
- Stem answerable by a candidate who has not seen the notes: no "according to the text/reference/section".
  Negative stems bold the negative: `**NOT**`, `**EXCEPT**`.
- Explanation ≥ 40 chars: teach the rule and cite the section; never "option B", never "the first option",
  never "the text says", never "(REP Ref. …)".
- Math items: `math.worked_solution` (every arithmetic step, ≥ 20 chars) and `math.formulas` (array); every
  distractor must come from a specific real mistake. Otherwise `math: null`.
- Exam relevance: rules a licensee applies in practice. Never appropriations, rulemaking/hearing procedure,
  agency administration, subpoena/court penalties, preemption/effective dates, transport/telecom provisions,
  antitrust definitions, or inflation-adjusted dollar penalties.
- Do not re-ask any rule listed under "Rules already covered"; do not lightly vary an existing stem.
- `cognitive_level`: knowledge (recall), application (scenario → apply rule), analysis (compare/compute/choose
  best action). Mix as the brief says. `terms`: 1–4 key terms.
