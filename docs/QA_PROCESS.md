# QA process (in-house)

Forson's decision (2026-09-08): no contracted reviewers for now; the model acting as lead reviewer
performs the human QA step, strictly by docs/QA_REVIEWER_GUIDE.md. This document is how that is run
so it stays auditable.

## Rules
1. **100% review of every item that survives verification**, not a sample, for the first 1,000 items
   of each bank type (national, first three states). Sampling (≥ 20% random, never the first N)
   only once a bank's measured rejection rate at 100% review has stayed under 10% for two batches.
2. Review is done from the **QA packet** (`pnpm pipeline qa-packet <bank>`): the item as the learner
   sees it plus the cited authority's enclosing section. The reviewer answers the stem before
   reading the key, then checks the six items in the guide. No packet, no verdict.
3. Verdicts are recorded only through `qa-approve` / `qa-reject` with the reviewer id
   `qa-lead-model`, so `reviewer` and `qa_approved_on` on every item show who signed it.
4. Every reject carries a one-sentence, actionable reason. Rejects are kept in
   `.pipeline/rejected/<bank>/` and aggregated after each batch into a prompt-tuning note in
   docs/QA_LOG.md (what class of error, how the drafting/verification prompt changed).
5. **Kill criterion tracking (SPEC §11):** the rejection rate per batch is logged. Above 20% after
   tuning means the content approach is failing and Forson is told plainly.
6. Helpers: to scale, batches of packets may be reviewed by delegated reviewer sessions using the
   same guide, but the lead reviewer re-reads **every reject** and a **random 25% of approvals** from
   each helper; a helper whose approvals are overturned more than 10% of the time is re-briefed and
   its batch re-reviewed in full.
7. Anything the reviewer cannot verify from the authority text is a reject ("unverifiable from cited
   text"), never an approve on general knowledge — the citation chain is the product.

## Per-batch log format (docs/QA_LOG.md)
```
## <date> <bank> batch <id>
drafted N · verified (3a/3b) M · reviewed M · approved A · rejected R (R/M = x%)
reject classes: key-wrong k · two-defensible d · citation-imprecise c · stale-law s · not-exam-relevant t · explanation-weak e · math m
prompt changes: ...
```

## Provisional mode (from 2026-09-09)
Forson's decision: banks are populated first and reviewed second. Agent-drafted items that pass the local gates (verbatim quote, citation-document match, lint incl. bank-wide dedupe) ship as `verified` with `review_reason: provisional…`. The model verifier and QA run behind; a rejected provisional item is retired by the next `publish --remote`. The 20 % kill criterion is tracked but no longer blocks drafting. See docs/AGENT_DRAFTING.md.
