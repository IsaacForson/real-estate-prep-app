# National exam blueprints

These YAML files are internal *structural* blueprints of the two national (non-state) real estate licensing exam outlines used in the US: `national_pearsonvue.yaml` (Pearson VUE publication 099913, salesperson and broker, effective Jan 2025+) and `national_psi.yaml` (PSI's national outline as printed in its state Candidate Information Bulletins, confirmed identical across GA, MA, VA, MD, ND, MI and CO).

Each file records the domain/subtopic identifiers (Roman numeral + letter, matching the vendor's numbering so items can be tagged consistently), the item counts or percentage weights, and, where published, the knowledge/application/analysis split. Pearson VUE publishes per-subtopic counts and cognitive splits; PSI publishes only per-domain percentages, so PSI `items` are our rounding onto an 80-item exam (scale by 1.25 for 100-item states such as GA and ND).

**Why the labels are paraphrased.** The vendor outlines are copyrighted. We record structure and numbers (facts) but deliberately do not copy the outline wording; every `label` is a short paraphrase of ours (about 10 words or fewer). Do not paste vendor outline text into these files or into item metadata. When writing items, work from the paraphrased label plus the referenced textbooks, not from the vendor PDF.

**How counts map to bank sizing.** Target roughly **11 bank items per 1 scored exam item** for a ~900-item national bank (80 scored items x 11 = 880, plus a margin for retirements). Apply the ratio at the *subtopic* level where a count exists (e.g. Pearson VUE I.A = 2 items -> ~22 bank items) and at the domain level where it does not (PSI V Contracts = 15 of 80 -> ~165 bank items). The two vendors carve the same subject matter differently; whether to dual-tag one shared pool or keep two banks is an open decision — see docs/DECISIONS.md.

Keep the Pearson VUE cognitive split roughly in proportion within each domain (salesperson ~50/34/16 K/A/An; broker ~25/35/40), and note that math (domain VIII) has no knowledge-level items on either exam. Re-verify both sources at least annually; the `accessed` and `source_version_or_date` fields say what was checked and when.
