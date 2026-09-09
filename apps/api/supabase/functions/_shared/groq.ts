/**
 * help-ai backend (V2_PLAN §1 "support"): Groq's OpenAI-compatible chat completions, grounded on the
 * knowledge-base entries the client sends. The prompt building and source extraction are pure so they
 * are unit-tested; the network call is a thin fetch.
 */

export const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
export const HELP_AI_MODEL = "openai/gpt-oss-120b";
export const HELP_AI_MAX_CONTEXT = 12;
export const HELP_AI_MAX_CONTEXT_CHARS = 2500;
export const HELP_AI_MAX_QUESTION_CHARS = 1000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface KbEntry {
  title: string;
  url: string | null;
  body: string;
}

/**
 * A context entry is either a plain string or a json string `{ title, url?, body|content|text }`
 * (what scripts/build-help-kb.ts emits into help.json). Anything else is ignored.
 */
export function parseKbEntry(raw: unknown, index: number): KbEntry | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const s = raw.trim();
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>;
      const body = [o.body, o.content, o.text].find((x) => typeof x === "string" && x.trim() !== "") as
        | string
        | undefined;
      const title = typeof o.title === "string" && o.title.trim() !== "" ? o.title.trim() : `Source ${index + 1}`;
      const url = typeof o.url === "string" && /^https?:\/\//.test(o.url) ? o.url : null;
      if (body) return { title, url, body: body.slice(0, HELP_AI_MAX_CONTEXT_CHARS) };
      return null;
    } catch {
      // fall through: treat as plain text
    }
  }
  const firstLine = s.split("\n")[0]!.replace(/^#+\s*/, "").trim();
  return {
    title: firstLine.length > 0 && firstLine.length <= 120 ? firstLine : `Source ${index + 1}`,
    url: null,
    body: s.slice(0, HELP_AI_MAX_CONTEXT_CHARS),
  };
}

export const HELP_SYSTEM_PROMPT = [
  "You are the in-app help assistant for a US real-estate licensing exam prep app (all 50 states + DC; $59 one-time",
  "for everything, forever; free tier = 20 questions in one state + one short mock). Answer ONLY from the numbered",
  "sources below. If the sources do not answer the question, say so in one sentence and suggest contacting support",
  "from the Help screen. Never invent prices, refund terms, legal rules or exam dates. Never give legal advice.",
  "Be brief (max ~120 words), plain language, no markdown headings. Cite sources inline as [n].",
].join(" ");

/** Build the chat messages: system prompt + numbered sources + the question. */
export function buildHelpMessages(
  question: string,
  context: unknown[],
): { messages: ChatMessage[]; sources: KbEntry[] } {
  const sources: KbEntry[] = [];
  for (let i = 0; i < context.length && sources.length < HELP_AI_MAX_CONTEXT; i++) {
    const e = parseKbEntry(context[i], sources.length);
    if (e) sources.push(e);
  }
  const numbered = sources.length
    ? sources.map((s, i) => `[${i + 1}] ${s.title}${s.url ? ` (${s.url})` : ""}\n${s.body}`).join("\n\n")
    : "(no sources provided)";
  const q = question.trim().slice(0, HELP_AI_MAX_QUESTION_CHARS);
  return {
    sources,
    messages: [
      { role: "system", content: HELP_SYSTEM_PROMPT },
      { role: "user", content: `SOURCES:\n${numbered}\n\nQUESTION: ${q}` },
    ],
  };
}

/** Titles (or urls) of the sources the answer cited as [n]; falls back to all sources when none cited. */
export function extractSources(answer: string, sources: KbEntry[]): string[] {
  const cited = new Set<number>();
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number.parseInt(m[1]!, 10);
    if (n >= 1 && n <= sources.length) cited.add(n - 1);
  }
  const pick = cited.size ? [...cited].sort((a, b) => a - b) : sources.map((_, i) => i);
  return pick.map((i) => sources[i]!.url ?? sources[i]!.title);
}

export interface GroqOptions {
  apiKey: string;
  model?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export type GroqResult = { ok: true; answer: string; model: string } | { ok: false; status: number; error: string };

export async function groqChat(messages: ChatMessage[], opts: GroqOptions): Promise<GroqResult> {
  const f = opts.fetchFn ?? fetch;
  const model = opts.model ?? HELP_AI_MODEL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25_000);
  try {
    const res = await f(GROQ_CHAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 400 }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      return { ok: false, status: res.status, error: text || res.statusText };
    }
    const data = await res.json() as { choices?: { message?: { content?: unknown } }[]; model?: string };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      return { ok: false, status: 502, error: "empty completion" };
    }
    return { ok: true, answer: content.trim(), model: typeof data.model === "string" ? data.model : model };
  } catch (e) {
    return { ok: false, status: 504, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
