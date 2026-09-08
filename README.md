# Real Estate Exam Prep — monorepo

US real estate licensing exam prep. All 50 states + DC state portions, both national banks
(Pearson VUE and PSI weighting), a statute citation behind every answer, one payment forever.
Full specification: [docs/SPEC.md](docs/SPEC.md). Scope decision and phases:
[docs/BUILD_SEQUENCE.md](docs/BUILD_SEQUENCE.md). Decision log: [docs/DECISIONS.md](docs/DECISIONS.md).

## Layout

```
content/                     the product's data — ships like code, linted in CI
  states/<XX>.yaml           Deliverable 0: 51-row state map from primary sources only
  blueprints/                internal exam blueprints (national_pearsonvue, national_psi, states/<XX>)
  statutes/<JUR>/*.md        cached ground-truth text (statutes, rules, federal law) — public domain
  items/<bank>/<domain>/     one YAML file per verified item
  glossary/                  vocabulary layer (F16)
packages/
  schema/                    @rep/schema — zod schemas + types for items, states, blueprints
  content-lint/              @rep/content-lint — SPEC §3.6 distractor rules; CI gate
  pipeline/                  @rep/pipeline — ingest → draft → verify → QA → publish
apps/                        client (Nuxt + Capacitor) and API — after the Phase 0 audio spike
docs/                        spec, build sequence, decisions, pipeline guide
```

## Commands

```bash
pnpm install
pnpm typecheck && pnpm test          # all packages
pnpm lint:content                    # lint everything under content/; non-zero exit on any ERROR
pnpm state-map                       # print the 51-row state map with confidence + unverified counts
pnpm pipeline plan national_pearsonvue
pnpm pipeline --help
```

See [docs/CONTENT_PIPELINE.md](docs/CONTENT_PIPELINE.md) for the full content workflow.

## Non-negotiables

- Every item cites a specific statute/rule section and quotes it verbatim. No citation, no merge.
- Never reproduce vendor outline text or any third-party question. Blueprint labels are paraphrases.
- State map values come from commission sites and official candidate bulletins only. Never blogs.
- All 51 jurisdictions are in scope. Order of production may vary; scope does not.
