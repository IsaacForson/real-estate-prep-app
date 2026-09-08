# Decision log

Short ADR-style entries. Newest first.

## 2026-09-08 — Full 50-state scope from day one
Forson overrode the spec's FL/TX/CA pilot. All 51 jurisdictions are in scope. See BUILD_SEQUENCE.md.

## 2026-09-08 — TypeScript monorepo (pnpm workspaces)
One language across content tooling, pipeline and client so the item schema (`@rep/schema`) is
imported by the lint, the pipeline and the app without translation. Python remains fine for
one-off research scripts (e.g. `nichescan.py`) but not for anything the app depends on.

## 2026-09-08 — Content lives in the repo as YAML, one file per item
Reviewable in PRs, diffable, CI-lintable. Items are grouped
`content/items/<bank>/<domain>/<id>.yaml`. No CMS.

## 2026-09-08 — Drafting model: `claude-opus-5` via Message Batches
Batches give 50% off and the pipeline is not latency-sensitive. Adaptive thinking on.
Verification is a separate structured-output call that must see the *statute text*, never only
the draft's own explanation, so it cannot rubber-stamp a hallucinated citation.

## 2026-09-08 — Near-duplicate detection runs locally in CI
CI must pass with no network. First pass is 3-gram shingle Jaccard on normalised stems (fails at
≥ 0.6). An embedding pass is a pipeline step, not a CI step.

## 2026-09-08 — Client: Nuxt 4 + Capacitor (pending the Phase 0 audio spike)
Chosen per SPEC §8 for the founder's Vue background and a free web product. React Native is the
fallback if background audio with speed control cannot be made reliable in the webview.
The spike is a Phase 0 gate; do not build the client shell before it passes.

## 2026-09-08 — OPEN: one national pool with dual vendor tags vs two separate national banks
The blueprint research surfaced that Pearson VUE and PSI test the same subject matter carved
differently. Option A (spec, current): two banks of ~900 items each, one `blueprint_node` per item.
Option B: one national pool where each item carries both a Pearson VUE node and a PSI node, and
the two "banks" are weighted views — roughly halves national drafting/QA cost while keeping
vendor-correct routing and mocks. Cost: schema change (`blueprint_nodes` map), and cognitive-split
targets differ per vendor. **Decision pending Forson.** Until then the pipeline builds Option A.

## 2026-09-08 — Client local store: Dexie (IndexedDB), not SQLite
SPEC §8 said SQLite via a local-first sync layer. The shell uses Dexie over IndexedDB instead:
it is available identically in browsers and the Capacitor webview with one code path, needs no
native plugin, and the sync unit (per-item `progress` rows with `clientUpdatedAt`, last-write-wins)
is the same either way. Revisit only if profiling shows IndexedDB too slow for ~22K cached items.

## 2026-09-08 — Web pages SSR, study app client-only
One Nuxt app: `/` and `/states/<XX>` render on the server (SEO for the 51 state landing pages,
SPEC §9), `/study/**` is client-only and offline-first, and `nuxt generate` output is what
Capacitor ships. Marketing copy and the exam-day brief come straight from `content/states`.

## 2026-09-08 — Audio (F6): Capacitor is a GO, via a native plugin
Spike result (docs/AUDIO_SPIKE.md): HTML5 audio in the webview cannot deliver background /
lock-screen narration on either platform; `@mediagrid/capacitor-native-audio` v3 can (AVAudioSession
+ Now Playing on iOS, Media3 MediaSessionService on Android). Gate stays open until the one-day
device checklist in that doc passes on a real iPhone and Android phone. Known gaps: iOS rate
snapping (one-line patch) and no lock-screen next/previous (skip ±15 s). React Native is no longer
the fallback of choice — its track player is now a paid licence.
`apps/app/lib/narration` is the framework-free module; `useNarration` drives it, using on-device
speech until pre-generated assets exist.

## 2026-09-08 — LLM backend: free-tier router, no Anthropic spend for now
Forson: "we don't have money for that yet." `packages/llm` is an OpenAI-compatible router over
Groq (default; `openai/gpt-oss-120b`), Cerebras, Mistral, DeepSeek and NVIDIA (7 keys, 40 RPM
each, round-robin with 60 s cooldowns on 429; `moonshotai/kimi-k3` primary — DeepSeek V4 Pro on
NVIDIA hangs). Providers returning 402/401 are disabled for the run. Prompts are chunked
(~5K tokens of authority per request) because Groq's free tier caps tokens per minute. Probe:
`pnpm --filter @rep/llm run cli probe`. `LLM_BACKEND=anthropic` restores the Batches path unchanged.
Quality risk accepted: gpt-oss-120b / Kimi K3 are weaker than Opus 5; the two automated gates plus
100% in-house QA (docs/QA_PROCESS.md) are the compensating control, and yield is measured per batch.
