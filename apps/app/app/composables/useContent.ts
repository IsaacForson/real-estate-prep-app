/** Static content manifest (states, blueprints, per-state status) built by scripts/build-content-manifest.ts. */
import type { StateRecord, Blueprint } from "@rep/schema";

export interface StateStatus { code: string; phase: string; verified: number; published: number; target: number; mocks: number }
export interface ContentManifest {
  generated: string;
  states: Record<string, StateRecord>;
  blueprints: Record<string, Blueprint>;
  status: Record<string, StateStatus>;
  nationalStatus: Record<string, StateStatus>;
  glossary: GlossaryTerm[];
  /** item id → latest version that has pre-generated audio */
  audio: Record<string, number>;
}
export interface GlossaryTerm { term: string; definition: string; source: string; quoted_text: string; related_terms: string[]; items: string[]; bank: string }

const EMPTY_MANIFEST: ContentManifest = { generated: "", states: {}, blueprints: {}, status: {}, nationalStatus: {}, glossary: [], audio: {} };

export function useContent() {
  const manifest = useState<ContentManifest | null>("content-manifest", () => null);
  const error = useState<boolean>("content-manifest-error", () => false);
  async function load(): Promise<ContentManifest> {
    if (manifest.value) return manifest.value;
    try {
      const data = await $fetch<ContentManifest>("/api/manifest");
      manifest.value = data;
      error.value = false;
      return data;
    } catch (e) {
      // A missing/unreachable manifest must not break Home/Study/Mocks: state names come from
      // @rep/schema regardless, and real question delivery goes through issue-batch, not this file.
      // Degrade to empty status/blueprints (dashes instead of numbers) rather than throwing.
      if (import.meta.dev) console.warn("[content] manifest fetch failed", e);
      error.value = true;
      return manifest.value ?? EMPTY_MANIFEST;
    }
  }
  return { manifest, error, load };
}
