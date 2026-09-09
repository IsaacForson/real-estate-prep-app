/**
 * Help Center (V2 §1 "Support"): local search over the static knowledge base
 * `public/content/help.json` (built from the repo docs by scripts/build-help-kb.ts — WP-E) and
 * `ask()` through the `help-ai` edge function (Groq, grounded on the KB). A missing KB (404) is not
 * an error: search returns nothing and `ask()` still works.
 */
import { parseHelpKb, searchHelp, type HelpAiResponse, type HelpArticle } from "~~/lib/state/contracts";
import { callFunction, functionsBase } from "~~/lib/study/api";

export type { HelpArticle };

let loading: Promise<HelpArticle[]> | null = null;

export function useHelp() {
  const config = useRuntimeConfig();
  const auth = useAuth();
  const kb = useState<HelpArticle[]>("help.kb", () => []);
  const loaded = useState<boolean>("help.loaded", () => false);
  const asking = useState<boolean>("help.asking", () => false);
  const error = useState<string | null>("help.error", () => null);

  /** Fetch the KB once; tolerate 404 / offline with an empty list. */
  function load(): Promise<HelpArticle[]> {
    if (loaded.value) return Promise.resolve(kb.value);
    if (!loading) {
      loading = (async () => {
        try {
          const res = await fetch(`${config.public.contentBase}/help.json`, { cache: "force-cache" });
          kb.value = res.ok ? parseHelpKb(await res.json()) : [];
        } catch {
          kb.value = [];
        } finally {
          loaded.value = true;
          loading = null;
        }
        return kb.value;
      })();
    }
    return loading;
  }
  if (import.meta.client && !loaded.value) void load();

  /** Synchronous ranked search over what is loaded; `search("")` lists every article (browse). */
  function search(q: string, limit = 8): HelpArticle[] {
    return searchHelp(kb.value, q, limit);
  }

  /** Ask the AI (signed in only); the server logs `help_ai_question`. */
  async function ask(q: string): Promise<HelpAiResponse> {
    error.value = null;
    const headers = await auth.authHeaders();
    if (!headers) { error.value = "Sign in to ask a question."; return { answer: "", sources: [] }; }
    asking.value = true;
    try {
      await load();
      const context = searchHelp(kb.value, q, 5).map((a) => a.id);
      const res = await callFunction<Partial<HelpAiResponse>>(functionsBase(config.public.supabaseUrl), "help-ai", { question: q.trim(), context }, headers);
      return { answer: typeof res.answer === "string" ? res.answer : "", sources: Array.isArray(res.sources) ? res.sources.filter((s): s is string => typeof s === "string") : [] };
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return { answer: "", sources: [] };
    } finally {
      asking.value = false;
    }
  }

  const sections = computed(() => [...new Set(kb.value.map((a) => a.category).filter((s): s is string => !!s))]);
  function byId(id: string): HelpArticle | null { return kb.value.find((a) => a.id === id || a.slug === id) ?? null; }

  return { kb, loaded, sections, load, search, ask, asking, error, byId };
}
