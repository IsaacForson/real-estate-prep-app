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
