# QA log

Per-batch record of the in-house review (docs/QA_PROCESS.md). Reviewer id `qa-lead-model`.

## 2026-09-08 national_pearsonvue — dev fixtures (8 hand-written items, apps/app/fixtures)
drafted 8 · gate 3a would have rejected 2 (quote not verbatim: 9005, 9008) · reviewed 8 · approved 5 · rejected 3 (37.5%)
reject classes: two-defensible 1 (9001: FHA § 3603(b)(2) owner-occupied ≤4-unit exemption made option B defensible; explanation misstated the exemption) · citation-imprecise 1 (9005: key rested on Reg B § 1002.6(b)(5), not the cited statute) · quote-not-verbatim 1 (9008)
disposition: fixtures corrected in place (version 2), all 8 quotes now locate in cached authorities, 0 lint errors
prompt changes: DRAFT_SYSTEM now (a) requires the writer to check exemptions/exceptions in the supplied text so no distractor is correct under an exemption, and (b) forbids items whose rule lives in a regulation or case law not present in the supplied text.
kill-criterion note: rate is on hand-written fixtures, not pipeline output; the first pipeline batch sets the real baseline.

## 2026-09-08 national_pearsonvue — first router batch (VIII.C, free providers)
drafted 4 (groq/gpt-oss-120b, 10 s) · gate 3a rejected 2 (0001: citation named § 4.1 of the math note but the quote lives in the Brokerage Practice note; 0004: numeric answer with no worked solution) · verifier rejected 1 (0002: options A and B numerically identical — $22,825 vs $22,825.00; caught by groq verifier) · verified 1 · reviewed 1 · approved 1 (0003) · rejected at QA 0
observations: 0003 is correct but reuses the exact figures of the note's Example A; 0001's stem said "According to the reference" — the candidate never sees a reference; the verifier fell over to nvidia/kimi-k3 when groq hit its per-minute cap, as designed.
prompt changes (draft-v3): fresh figures (never reuse worked-example numbers); numeric answers MUST carry math.worked_solution; numeric options must be numerically distinct and identically formatted; no "according to the reference/text" wording; no verbatim-definition items.
lint changes: `meta-reference-in-stem` and `options-numerically-equal` (both error).
yield so far: 1 approved / 4 drafted = 25% — expected to rise sharply with v3; the wider pilot (one pass over every node) sets the real baseline.

## 2026-09-08 national_pearsonvue — glossary (F16) first run
terms 3 · defined 3 · reviewed 3 · approved 1 (agent) · rejected 2 (commission → defined the Federal Trade Commission from TILA §1602; split → RESPA fee-splitting). Cause: term lookup without the items' context picked the wrong sense.
fix: generator now receives the stems of the items using each term and must define that sense or omit; reference notes are searched before statutes; entries carry draft/quote_verified/approved/rejected and only approved ships to the app.

## 2026-09-08 national_pearsonvue — pilot pass 1 (all 33 nodes, free router: 42 requests kimi-k3, 4 groq)
drafted 184 · gate 3a rejected 125 (lint 94: absolute-qualifier 42, option-length 28, negative-stem-not-bolded 13, math-worked-solution 10, meta-reference 1; source-doc-mismatch 53; quote-not-found 7) · to verifier 59 · verifier rejected 3 · verifier calls failed 23 (all providers rate-limited at once — router gave up too early) · verified 33
**reviewed 33 · approved 30 · rejected 3 (9%)** — rejects: III-0025, III-0027, V-0069, all for explanations that say "the reference/the text states…" (candidate never sees a reference). Every key checked against the located authority text; all arithmetic recomputed (0006, 0049, 0122, 0136, 0152, 0153).
findings: (1) 53 "source-doc mismatches" were citation FORM, not substance — models wrote the bare section heading ("§ 13.2 Vacancy…") without the document name; (2) my absolute-qualifier rule fired on ordinary "all/only/every"; SPEC means always/never; (3) models key "A" almost every time (first 9 verified all keyed A); (4) verifier timeouts were the router, not the items.
changes: normalize.ts — auto-bold NOT/EXCEPT/LEAST, complete bare-heading citations with the document the quote was found in, deterministic per-item option shuffle (31 existing items reshuffled → A10 B5 C7 D9); lint — absolute qualifiers narrowed to always/never family, short-option length slack, meta-reference rule extended to explanations; prompt draft-v4 — citation.source must start with the document citation; no "the reference/the text" anywhere; router — up to 6 wait passes, daily-limit 429s disable the provider for the run, 15 s cooldowns for multi-key providers. 119 rule-rejected drafts requeued + 23 failed = 142 re-verifying.

## 2026-09-08 national_pearsonvue — pass 2 (142 requeued/failed drafts) + distractor balancing
verify pass 2: 142 → 3a rejected 42 · verified 37 · verifier rejected 12 · verifier calls failed 51 (all providers rate-limited simultaneously; re-running as pass 3)
balancing: 14 items had the key as the unique longest option → distractors rewritten (key text untouched), returned to "verified" for re-review; 2 of them (III-0024, VII-0117) came back lint-dirty and were rejected; balancing now lint-checks its own output and retries once.
key positions: assigned round-robin per domain (60 items → A 20 / B 18 / C 15 / D 14 → uniform after re-keying).
**reviewed 42 (35 new + 7 rebalanced) · approved 37 · rejected 5** — II-0016 (rebalanced distractor half-right), III-0031, III-0046, VII-0135 (explanations refer to options by LETTER — letters change under re-keying), VI-0092 (two options both restate the petroleum exclusion).
false alarm corrected: the new `explanation-option-letter` lint matched statutory subsection letters "(C)" in citations; four correct items (V-0100, VI-0099, VII-0122, VII-0124) were rejected on that basis and have been restored to approved; the pattern now ignores "(X)" between parentheses or after a digit.
running totals for the bank: 60 approved · 0 pending · rejected at QA 13 of 73 reviewed (18%) · drafting yield so far ≈ 60 approved / 184 drafted (33%) before pass 3.
prompt draft-v5: explanations describe distractors by content, never by letter.

## 2026-09-08 national_pearsonvue — passes 3–4 (51 drafts whose verifier calls had failed)
pass 3 stalled: every call 429 on nvidia/kimi-k3 across all keys (the seven keys share one account-level limit), groq on its daily cap, mistral throttled → 0 completions; router changed to fall through to the provider's next model when every key is limited, verifier moved to nvidia/minimax-m3 (nemotron-3-super as fallback), concurrency 3.
pass 4: 51 → 3a rejected 10 · verified 30 · verifier rejected 10 · failed 1 (providers: minimax 14, nemotron 28, groq 1).
balancing 1 item; re-keyed 90 → A 25 / B 23 / C 22 / D 20.
**reviewed 30 · approved 25 · rejected 5** — V-0064, V-0065 (near-duplicate stems of V-0060/V-0061, caught by lint), V-0071 ("the text directs…" meta reference; regex widened), VIII-0174 (explanation discusses a $0 option that does not exist), VIII-0176 (explanation misstates how the $1.25 distractor arises).
**bank totals: 85 approved · 0 pending · 21 rejected at QA of 106 reviewed (20%) · 85 approved / 184 drafted = 46% yield.** The QA rejection rate sits exactly at the SPEC §11 kill line, but 15 of the 21 rejects were classes now caught upstream by lint (meta references, option letters, duplicates), so the next batch's QA rate should fall well under 20%; drafting yield is the number to watch.
next: full remaining PV draft (≈795 items) with draft-v5 + normalizations + balancing, then review.
