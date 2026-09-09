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

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Coerce a response body into a manifest that is always safe to index, or null if it is not one.
 *
 * The wire format cannot be trusted. Inside the packaged Capacitor app the manifest is a static
 * file served by Capacitor's own local server, which types an asset from its file extension and
 * only falls back to sniffing the bytes — and a bare JSON body sniffs as nothing. Served as the
 * extension-less `/api/manifest` it came back with no `application/json` content type, so ofetch
 * returned the raw *string*. A string is truthy, so it was stored as the manifest, and then every
 * `manifest.states[code]` / `manifest.status[code]` lookup threw "Cannot read properties of
 * undefined" mid-render: Mocks, Review and the state picker rendered nothing on device while the
 * browser (real server, real content type) was fine. Parse explicitly, verify the shape, and
 * spread over the empty manifest so every key exists even for an older or partial build.
 */
function coerce(input: unknown): ContentManifest | null {
  const raw = typeof input === "string" ? safeParse(input) : input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Partial<ContentManifest>;
  if (!o.states || typeof o.states !== "object") return null;
  return { ...EMPTY_MANIFEST, ...o };
}

export function useContent() {
  const manifest = useState<ContentManifest | null>("content-manifest", () => null);
  const error = useState<boolean>("content-manifest-error", () => false);
  /** Only a real, parsed manifest short-circuits the next call, so a bad response stays retryable. */
  const loaded = useState<boolean>("content-manifest-loaded", () => false);

  async function load(): Promise<ContentManifest> {
    if (loaded.value && manifest.value) return manifest.value;
    try {
      // Read as text and parse here: never depend on the response's content type (see coerce()).
      const body = await $fetch<string>("/api/manifest.json", { responseType: "text" });
      const data = coerce(body);
      if (!data) throw new Error("manifest response was not a content manifest");
      manifest.value = data;
      loaded.value = true;
      error.value = false;
      return data;
    } catch (e) {
      // A missing/unreachable manifest must not break Home/Study/Mocks: state names come from
      // @rep/schema regardless, and real question delivery goes through issue-batch, not this file.
      // Degrade to empty status/blueprints (dashes instead of numbers) rather than throwing.
      if (import.meta.dev) console.warn("[content] manifest fetch failed", e);
      error.value = true;
      loaded.value = false;
      // Whatever happened, leave an indexable object behind — never a string, blob or null.
      if (!manifest.value || typeof manifest.value !== "object") manifest.value = EMPTY_MANIFEST;
      return manifest.value ?? EMPTY_MANIFEST;
    }
  }
  return { manifest, error, load };
}
