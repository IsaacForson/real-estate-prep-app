/**
 * F16 — vocabulary layer. `pipeline glossary <bank>` collects every `terms` entry from the bank's
 * verified/approved/published items, then asks the router to define each term FROM the cached
 * authorities (reference notes and statutes), with a verbatim quote we can locate — the same
 * citation discipline as items. Output: content/glossary/<bank>.yaml.
 */
import { join } from "node:path";
import { z } from "zod";
import { Item } from "@rep/schema";
import { loadItems } from "@rep/content-lint";
import { LlmRouter, chatJson, mapLimit } from "@rep/llm";
import { CONFIG } from "./config.js";
import { readYaml, writeYaml, existsSync } from "./fsx.js";
import { loadStatutes, quoteAppears, today, type StatuteDoc } from "./statutes.js";
import { locateQuote } from "./cite.js";

export const GlossaryEntry = z.object({
  term: z.string().min(2),
  definition: z.string().min(30).max(600),
  /** Authority the definition rests on, with a verbatim quote that must locate in the cache. */
  source: z.string().min(4),
  quoted_text: z.string().min(15),
  related_terms: z.array(z.string()).default([]),
});
export type GlossaryEntry = z.infer<typeof GlossaryEntry>;
const Batch = z.object({ entries: z.array(GlossaryEntry) });

export interface GlossaryFile {
  bank: string;
  generated_on: string;
  /** draft = quote not located; quote_verified = quote located (automatic); approved/rejected = reviewer verdict. Only approved ships. */
  entries: Array<GlossaryEntry & { items: string[]; status: "draft" | "quote_verified" | "approved" | "rejected"; model: string; reviewer?: string; reject_reason?: string }>;
}

const SYSTEM = `You write glossary definitions for US real estate licensing exam candidates. For each term you are given (a) the exam questions that use the term — these fix the SENSE you must define (e.g. "commission" in a question about an agent's pay means brokerage compensation, never a government commission) — and (b) passages of authority text that mention the term. Write a 1–3 sentence definition in plain English, in the sense the questions use, grounded ONLY in a supplied passage that describes that sense. Cite that passage (its bracketed heading) as \`source\` and copy 15–200 characters VERBATIM from it as \`quoted_text\`. If no passage describes the term in the sense the questions use, OMIT the term — never define a different sense. Do not name vendors. Return only JSON.`;

function normalize(t: string) { return t.toLowerCase().replace(/[^a-z0-9 \-]/g, "").replace(/\s+/g, " ").trim(); }

/** Passages mentioning the term: up to 3 windows of ~700 chars each, headed by the doc citation and nearest § heading. */
function passagesFor(term: string, docs: StatuteDoc[], max = 3): string[] {
  const out: string[] = [];
  docs = [...docs].sort((a, b) => Number(!a.citation.startsWith("REP Ref.")) - Number(!b.citation.startsWith("REP Ref.")));
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i");
  for (const d of docs) {
    const i = d.text.search(re);
    if (i < 0) continue;
    const start = Math.max(0, i - 350), end = Math.min(d.text.length, i + 350);
    const before = d.text.slice(0, i);
    const head = [...before.matchAll(/\n[ \t]*(?:#{1,4}\s*)?(§+\s*[^\n]{3,80}|Sec\.\s*[^\n]{3,80})/g)].at(-1)?.[1]?.trim() ?? "";
    out.push(`[${d.citation}${head ? " — " + head : ""}]\n${d.text.slice(start, end).trim()}`);
    if (out.length >= max) break;
  }
  return out;
}

export async function buildGlossary(bank: string, opts: { log?: (s: string) => void; limit?: number } = {}): Promise<{ terms: number; defined: number; verified: number; path: string }> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const items = loadItems(CONFIG.contentDir).items.map((x) => x.value).filter((i) => i.bank === bank && i.status !== "draft" && i.status !== "retired");
  const jur = bank.startsWith("state_") ? bank.slice(6) : "NAT";
  const docs = [...loadStatutes(jur), ...(jur !== "NAT" ? loadStatutes("NAT") : [])];
  const path = join(CONFIG.contentDir, "glossary", `${bank}.yaml`);
  const existing: GlossaryFile = existsSync(path) ? (readYaml(path) as GlossaryFile) : { bank, generated_on: today(), entries: [] };
  const have = new Set(existing.entries.map((e) => normalize(e.term)));

  const byTerm = new Map<string, { term: string; items: Set<string>; stems: string[] }>();
  for (const it of items) for (const t of it.terms) {
    const k = normalize(t); if (!k || have.has(k)) continue;
    if (!byTerm.has(k)) byTerm.set(k, { term: t.trim(), items: new Set(), stems: [] });
    byTerm.get(k)!.items.add(it.id);
    if (byTerm.get(k)!.stems.length < 3) byTerm.get(k)!.stems.push(it.stem.replace(/\*\*/g, ""));
  }
  let todo = [...byTerm.values()];
  if (opts.limit) todo = todo.slice(0, opts.limit);
  log(`glossary ${bank}: ${byTerm.size} new terms from ${items.length} items${opts.limit ? ` (limit ${opts.limit})` : ""}`);
  if (!todo.length) return { terms: 0, defined: 0, verified: 0, path };

  const router = new LlmRouter(); router.log = log;
  const groups: typeof todo[] = [];
  for (let i = 0; i < todo.length; i += 8) groups.push(todo.slice(i, i + 8));
  let defined = 0, verified = 0;
  const results = await mapLimit(groups, 3, async (group) => {
    const blocks = group.map((g) => {
      const ps = passagesFor(g.term, docs);
      return `TERM: ${g.term}\nUSED IN QUESTIONS:\n- ${g.stems.join("\n- ")}\nPASSAGES:\n${ps.length ? ps.join("\n\n") : "(no passage found — omit this term)"}`;
    });
    const { data, result } = await chatJson(router, Batch, [
      { role: "system", content: SYSTEM },
      { role: "user", content: blocks.join("\n\n=====\n\n") + `\n\nReturn JSON: {"entries":[{"term","definition","source","quoted_text","related_terms":[]}]}` },
    ], { maxTokens: 4000, temperature: 0.2 });
    for (const e of data.entries) {
      const g = group.find((x) => normalize(x.term) === normalize(e.term)) ?? group.find((x) => normalize(e.term).includes(normalize(x.term)));
      if (!g) continue;
      const ok = docs.some((d) => quoteAppears(e.quoted_text, d.text));
      const hit = ok ? locateQuote(docs, e.quoted_text) : null;
      existing.entries.push({ ...e, source: hit ? hit.doc.citation : e.source, items: [...g.items], status: ok ? "quote_verified" : "draft", model: `${result.provider}/${result.model}` });
      defined++; if (ok) verified++;
    }
  });
  for (const r of results) if (!r.ok) log(`  FAILED glossary batch: ${String(r.error).slice(0, 200)}`);
  existing.generated_on = today();
  existing.entries.sort((a, b) => a.term.localeCompare(b.term));
  writeYaml(path, existing);
  return { terms: todo.length, defined, verified, path };
}

/** Reviewer verdicts on glossary entries (same discipline as items: only approved entries ship). */
export function reviewGlossary(bank: string, verdict: "approved" | "rejected", reviewer: string, terms: string[], reason?: string): number {
  const path = join(CONFIG.contentDir, "glossary", `${bank}.yaml`);
  const g = readYaml(path) as GlossaryFile;
  let n = 0;
  for (const e of g.entries) if (terms.some((t) => normalize(t) === normalize(e.term))) { e.status = verdict; e.reviewer = reviewer; if (reason) e.reject_reason = reason; n++; }
  writeYaml(path, g);
  return n;
}
