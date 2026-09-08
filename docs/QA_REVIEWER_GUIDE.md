# Item review guide — for licensed reviewers

You are reviewing multiple-choice practice items for a real estate licensing exam prep product.
Every item has already passed two automated gates: its quoted authority text exists verbatim in
the statute, rule, or reference note it cites, and an independent model verifier judged the key
supported. Your job is the check machines cannot do: **would a competent licensee in your state
agree this item is correct, fair, current, and worth a candidate's time?**

You are paid per batch. Batches are random samples of a bank (we never send you the first N
items). Expect 50–100 items per sheet; budget 2–3 minutes per item.

## What you receive

A CSV with one row per item: `id, node, level, stem, A, B, C, D, key, explanation, citation,
quoted_text` and two empty columns you fill: `reviewer_verdict (approve/reject)` and
`reviewer_notes`. You also get read access to the authority texts in `content/statutes/<STATE>/`
so you can open the cited section.

## The check, in order

1. **Is the key right?** Read the stem and answer it yourself before looking at the key. Then open
   the cited section and confirm the quoted text says what the explanation claims. If the statute
   was amended and the item is stale, reject and give the amendment (bill number or effective date).
2. **Is exactly one option correct?** Each distractor must be clearly wrong under the cited text.
   If a distractor is arguably right in your state's practice, reject — "arguably" is enough.
3. **Is the stem fair?** No trick wording, no double negatives, no information a candidate could
   not know, no reliance on a specific vendor's phrasing. Negative stems must bold the negation.
4. **Does it test what the exam tests?** The `node` column is the outline topic. If the item is
   trivia (fee amounts nobody is examined on, historical dates) or tests the outline label rather
   than the rule, reject with "not exam-relevant".
5. **Is the explanation useful?** It should state the rule, cite the section, and say why the
   tempting distractor is wrong. Padding, hedging, or "as stated above" → reject.
6. **Math items**: recompute the worked solution. A wrong intermediate step is a reject even when
   the final number is right.

Mark `approve` only if all six pass. Anything else is `reject`, with a note a stranger could act
on: quote the problem, name the correct answer if the key is wrong, cite the section if the law
changed. One sentence is usually enough. "Bad question" is not enough.

## Things that are not your job

- Style, comma placement, British vs American spelling — ignore unless it changes meaning.
- Whether a *different* question would have been better — we only need to know if this one is right.
- Checking the citation format — the pipeline does that.

## Conflicts and confidentiality

Do not copy items into other products, prep courses, or study groups; they are our proprietary
content and each batch carries per-reviewer canary items. Do not paste real exam questions you
remember into notes — we never use recalled exam content, and we cannot accept it from you.

## Payment and turnaround

Per-batch flat fee agreed in your contract, paid on receipt of a completed sheet. Target turnaround
is 5 business days. If more than 20% of a batch is rejected we will ask you for a short call: that
rate means the drafting for that bank needs fixing, and your notes are the evidence.

## How your verdicts are applied

```bash
pnpm pipeline qa-approve <your_reviewer_id> <item ids…>
pnpm pipeline qa-reject  <your_reviewer_id> <item id> "<your note>"
```

Approved items are stamped with your reviewer id and date and can be published. Rejected items
are retired with your note attached and never reappear unless re-drafted as a new item.
