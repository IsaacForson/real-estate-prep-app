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

export function useContent() {
  const manifest = useState<ContentManifest | null>("content-manifest", () => null);
  async function load(): Promise<ContentManifest> {
    if (manifest.value) return manifest.value;
    const data = await $fetch<ContentManifest>("/api/manifest");
    manifest.value = data;
    return data;
  }
  return { manifest, load };
}
