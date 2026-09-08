# State-portion blueprints

One file per jurisdiction, `<XX>.yaml`, `id: state_XX`. All 51 are in scope.

Each file mirrors the **state-specific** content outline published in that state's official
candidate information bulletin (Pearson VUE handbook, PSI CIB, or the commission's own outline
for self-administered exams). We record *structure and counts* — topic ids, our own paraphrased
labels, item counts (or our rounding of published percentages onto the scored item count) —
never the outline's wording (SPEC §3.2).

The extra field that matters here is `statute_refs` on every subtopic: the license-law and
commission-rule sections that ground the topic. The pipeline drafts a node **only** from the
cached text of those sections (`content/statutes/<XX>/`). No refs, no items.

`exams.salesperson.scored_items` must equal `salesperson_exam.state_items` in
`content/states/<XX>.yaml`, and domain items must sum to it — `pnpm lint:content` enforces both.
For jurisdictions that give one combined exam with no separate state section (e.g. CA, WI),
`scored_items` is the whole exam and the blueprint covers all of it.

Template: `_TEMPLATE.yaml.example`.
