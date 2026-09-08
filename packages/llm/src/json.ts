/** JSON-mode helper: ask, parse, validate with zod, one repair round-trip on failure. */
import type { z } from "zod";
import type { LlmRouter, ChatMessage, ChatResult } from "./router.js";

export function extractJson(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch {}
  // find the outermost {...} or [...]
  const start = Math.min(...["{", "["].map((c) => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
  if (!isFinite(start)) throw new Error("no JSON found in model output");
  const open = t[start]!, close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i]!;
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return JSON.parse(t.slice(start, i + 1)); }
  }
  throw new Error("unbalanced JSON in model output");
}

export async function chatJson<T>(router: LlmRouter, schema: z.ZodType<T>, messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number; providers?: string[] } = {}): Promise<{ data: T; result: ChatResult }> {
  let result = await router.chat({ messages, json: true, maxTokens: opts.maxTokens, temperature: opts.temperature, providers: opts.providers });
  let parsed: unknown;
  let issue = "";
  try { parsed = extractJson(result.text); const v = schema.safeParse(parsed); if (v.success) return { data: v.data, result }; issue = v.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "); }
  catch (e) { issue = String(e); }
  // one repair attempt: show the model its output and the validation errors
  const repair: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: result.text.slice(0, 20_000) },
    { role: "user", content: `Your JSON did not validate: ${issue}. Return ONLY the corrected JSON object with the same content, fixing those problems.` },
  ];
  result = await router.chat({ messages: repair, json: true, maxTokens: opts.maxTokens, temperature: 0.2, providers: opts.providers });
  parsed = extractJson(result.text);
  const v = schema.safeParse(parsed);
  if (!v.success) throw new Error(`model output failed validation after repair: ${v.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return { data: v.data, result };
}

/** Run async jobs with a concurrency limit; preserves order of results. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const out: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = { ok: true, value: await fn(items[i]!, i) }; } catch (error) { out[i] = { ok: false, error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
