/**
 * Direct (non-batch) drafting and verification through the free-tier LLM router (`@rep/llm`).
 * Same prompts, schemas and gates as the Anthropic Batches path; differences:
 *   - authority text is CHUNKED per request (free tiers cap tokens per minute), each chunk drafting
 *     a few items grounded in that chunk only;
 *   - requests run concurrently with a limit and the router handles key rotation / cooldowns;
 *   - results are written immediately (no collect step).
 */
import { join } from "node:path";
import { Item } from "@rep/schema";
import { LlmRouter, chatJson, mapLimit, loadProviders } from "@rep/llm";
import { CONFIG } from "./config.js";
import { writeYaml, listFiles, readYaml } from "./fsx.js";
import { loadStatutes, today } from "./statutes.js";
import { resolveRefs, locateQuote, excerptAround, refMatchesDoc } from "./cite.js";
import { planBank, cognitiveMixFor, existingItems } from "./plan.js";
import { DRAFT_SYSTEM, draftUserPrompt, VERIFY_SYSTEM, verifyUserPrompt } from "./prompts.js";
import { isRepairable, repairItem } from "./repair.js";
import { DraftBatchSchema, bankMeta, nodeStatuteRefs, nextIdFactory, draftToItem } from "./draft.js";
import { Verdict, localCheck, reject, jurOf } from "./verify.js";
import { normalizeDraft } from "./normalize.js";
import { needsBalancing, balanceItem } from "./balance.js";
import { unlinkSync, existsSync } from "node:fs";

export const DIRECT = {
  /** ≈ 5K tokens of authority text per request — fits Groq's free tier with room for the task + output. */
  chunkChars: Number(process.env.DRAFT_CHUNK_CHARS ?? 18_000),
  itemsPerChunk: Number(process.env.DRAFT_ITEMS_PER_CHUNK ?? 3),
  concurrency: Number(process.env.LLM_CONCURRENCY ?? 4),
};

/** Split resolved authority text into chunks at section boundaries ("### " headings), then by paragraphs. */
let exclusionCache: RegExp[] | null = null;
/** content/exclusions.yaml → heading regexes of never-examinable sections (QA batches 2–3). */
export function loadExclusions(): RegExp[] {
  if (exclusionCache) return exclusionCache;
  const path = join(CONFIG.contentDir, "exclusions.yaml");
  const raw = existsSync(path) ? (readYaml(path) as { heading_patterns?: string[] }) : {};
  exclusionCache = (raw.heading_patterns ?? []).map((p) => {
    const m = /^\(\?i\)/.exec(p);
    return new RegExp(m ? p.slice(4) : p, m ? "i" : "");
  });
  return exclusionCache;
}
/** Drop "### " sections whose heading matches an exclusion; returns the text and the number of sections removed. */
export function stripExcludedSections(text: string, patterns = loadExclusions()): { text: string; removed: string[] } {
  if (!patterns.length) return { text, removed: [] };
  const removed: string[] = [];
  const kept = text.split(/\n(?=### )/g).filter((sec) => {
    const heading = sec.match(/^### [^\n]*/)?.[0] ?? "";
    if (heading && patterns.some((re) => re.test(heading))) { removed.push(heading.slice(4).trim()); return false; }
    return true;
  });
  return { text: kept.join("\n"), removed };
}

export function chunkAuthority(text: string, max = DIRECT.chunkChars): string[] {
  const sections = text.split(/\n(?=### )/g);
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const sec of sections) {
    if (sec.length > max) {
      push();
      // split a huge section by paragraphs, keeping its heading on each piece
      const heading = sec.match(/^### [^\n]*/)?.[0] ?? "";
      let piece = heading;
      for (const para of sec.split(/\n\n+/)) {
        if ((piece + "\n\n" + para).length > max && piece.length > heading.length) { out.push(piece.trim()); piece = heading + "\n\n(continued)"; }
        piece += "\n\n" + para;
      }
      if (piece.trim().length > heading.length) out.push(piece.trim());
      continue;
    }
    if ((cur + "\n\n" + sec).length > max) push();
    cur += (cur ? "\n\n" : "") + sec;
  }
  push();
  return out;
}

export interface DirectDraftResult { requested: number; written: number; failed: number; byProvider: Record<string, number>; log: string[] }

export async function draftDirect(bank: string, opts: { nodes?: string[]; limit?: number; log?: (s: string) => void } = {}): Promise<DirectDraftResult> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const router = new LlmRouter(); router.log = log;
  const meta = bankMeta(bank);
  const jur = meta.jur;
  const docs = loadStatutes(jur);
  if (!docs.length) throw new Error(`no statute text cached for ${jur}`);
  let gaps = planBank(bank).filter((g) => g.gap > 0);
  if (opts.nodes?.length) gaps = gaps.filter((g) => opts.nodes!.includes(g.node));
  const existing = existingItems(bank);
  const nextId = nextIdFactory(bank);

  type Job = { node: string; label: string; examItems: number; count: number; chunk: string; chunkIdx: number; chunks: number; cog: Record<"knowledge" | "application" | "analysis", number> };
  const jobs: Job[] = [];
  for (const g of gaps) {
    const refs = nodeStatuteRefs(bank, g.node);
    if (!refs.length) { log(`skip ${g.node}: no statute_refs`); continue; }
    const r = resolveRefs(refs, docs);
    if (!r.text) { log(`skip ${g.node}: refs match nothing cached (${refs.join(", ")})`); continue; }
    if (r.unmatched.length) log(`warn ${g.node}: refs not cached: ${r.unmatched.join(", ")}`);
    const stripped = stripExcludedSections(r.text);
    if (stripped.removed.length) log(`  ${g.node}: excluded ${stripped.removed.length} non-examinable section(s): ${stripped.removed.slice(0, 4).join(" | ")}${stripped.removed.length > 4 ? " …" : ""}`);
    if (!stripped.text.trim()) { log(`skip ${g.node}: nothing examinable left after exclusions`); continue; }
    const chunks = chunkAuthority(stripped.text);
    const want = Math.min(g.gap, opts.limit ?? g.gap);
    // spread the node's items across its chunks, at most itemsPerChunk per request; rotate chunks if more needed
    let remaining = want, ci = 0, round = 0;
    while (remaining > 0 && round < 50) {
      const count = Math.min(DIRECT.itemsPerChunk, remaining);
      jobs.push({ node: g.node, label: g.label, examItems: g.exam_items, count, chunk: chunks[ci % chunks.length]!, chunkIdx: ci % chunks.length, chunks: chunks.length, cog: cognitiveMixFor(count, g.cognitive_split) });
      remaining -= count; ci++; if (ci % chunks.length === 0) round++;
    }
  }
  const requested = jobs.reduce((a, j) => a + j.count, 0);
  log(`direct draft ${bank}: ${jobs.length} requests / ${requested} items across ${new Set(jobs.map((j) => j.node)).size} nodes; providers ${router.available.join(" → ")}`);

  const stemsByNode = new Map<string, string[]>();
  for (const i of existing) { const k = i.blueprint_node; if (!stemsByNode.has(k)) stemsByNode.set(k, []); stemsByNode.get(k)!.push(i.stem); }
  // rules already covered anywhere in the bank's domain: the keyed answer text of every existing item (dedupe control, QA batch 3)
  const answersByDomain = new Map<string, string[]>();
  for (const i of existing) {
    const d = i.blueprint_node.split(".")[0]!;
    const key = i.options["ABCD".indexOf(i.key)] ?? "";
    if (!answersByDomain.has(d)) answersByDomain.set(d, []);
    if (key.length >= 12) answersByDomain.get(d)!.push(key);
  }
  const byProvider: Record<string, number> = {};
  let written = 0, failed = 0, balanced = 0;
  const results = await mapLimit(jobs, DIRECT.concurrency, async (j) => {
    const { statuteBlock, taskBlock } = draftUserPrompt({
      bank, jurisdictionName: meta.name, vendor: meta.vendor, target: { node: j.node, label: j.label, exam_items: j.examItems, target_bank_items: 0 }, count: j.count,
      cognitiveMix: j.cog, statuteCitationRoot: meta.statuteRoot, statuteText: j.chunk, existingStems: (stemsByNode.get(j.node) ?? []).slice(-40),
      coveredAnswers: [...new Set(answersByDomain.get(j.node.split(".")[0]!) ?? [])].slice(-80),
    });
    const note = j.chunks > 1 ? `\n\nNOTE: this is part ${j.chunkIdx + 1} of ${j.chunks} of the node's authority text. Write items answerable from THIS part only.` : "";
    const { data, result } = await chatJson(router, DraftBatchSchema, [
      { role: "system", content: DRAFT_SYSTEM },
      { role: "user", content: `${statuteBlock}\n\n${taskBlock}${note}` },
    ], { maxTokens: 9000, temperature: 0.5 });
    byProvider[`${result.provider}/${result.model}`] = (byProvider[`${result.provider}/${result.model}`] ?? 0) + 1;
    for (const d of data.items) {
      const id = nextId(j.node);
      let item = normalizeDraft(draftToItem(d, { id, bank, node: j.node, model: `${result.provider}/${result.model}`, promptVersion: CONFIG.promptVersion, batchId: null }), docs);
      if (needsBalancing(item)) {
        try { const b = await balanceItem(router, item, j.chunk); if (b.changed) { item = { ...b.item, version: 1 }; balanced++; } }
        catch (e) { log(`  balance failed for ${id}: ${String(e).slice(0, 120)}`); }
      }
      writeYaml(join(CONFIG.stateDir, "drafts", bank, `${id}.yaml`), item);
      stemsByNode.set(j.node, [...(stemsByNode.get(j.node) ?? []), d.stem]);
      written++;
    }
    log(`  ${j.node} chunk ${j.chunkIdx + 1}/${j.chunks}: ${data.items.length} items via ${result.provider}/${result.model} (${result.ms}ms)`);
  });
  for (const r of results) if (!r.ok) { failed++; log(`  FAILED request: ${String(r.error).slice(0, 300)}`); }
  log(`distractors rebalanced on ${balanced} items (key was the longest option)`);
  return { requested, written, failed, byProvider, log: [] };
}

export interface DirectVerifyResult { drafts: number; localRejected: number; verified: number; rejected: number; failed: number; byProvider: Record<string, number> }

export async function verifyDirect(bank: string, opts: { log?: (s: string) => void } = {}): Promise<DirectVerifyResult> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const router = new LlmRouter(loadProviders("verify")); router.log = log; // VERIFY_<PROVIDER>_MODEL overrides
  const drafts = listFiles(join(CONFIG.stateDir, "drafts", bank), ".yaml");
  if (!drafts.length) throw new Error(`no drafts for ${bank}`);
  const jur = jurOf(bank);
  const statutes = loadStatutes(jur);
  const texts = statutes.map((s) => s.text);
  let localRejected = 0, verified = 0, rejected = 0, failed = 0, repaired = 0;
  const byProvider: Record<string, number> = {};
  const survivors: Array<{ path: string; item: Item; excerpt: string; docCitation: string }> = [];
  for (const path of drafts) {
    const parsed = Item.safeParse(readYaml(path));
    if (!parsed.success) { log(`${path}: schema invalid — ${parsed.error.issues[0]?.message}`); failed++; continue; }
    let item = normalizeDraft(parsed.data, statutes);
    let lc = localCheck(item, texts);
    if (!lc.ok && isRepairable(lc.reasons)) {
      try {
        const r = await repairItem(router, item, lc.reasons);
        if (r.changed) { item = r.item; lc = localCheck(item, texts); repaired++; log(`  ${item.id}: ${r.note}`); }
      } catch (e) { log(`  repair failed for ${item.id}: ${String(e).slice(0, 120)}`); }
    }
    if (!lc.ok) { reject(bank, item, lc.reasons, path); localRejected++; continue; }
    const hit = locateQuote(statutes, item.citation.quoted_text)!;
    if (!refMatchesDoc(item.citation.source, hit.doc.citation)) { reject(bank, item, [`citation.source "${item.citation.source}" does not correspond to the document containing the quote (${hit.doc.citation})`], path); localRejected++; continue; }
    survivors.push({ path, item, excerpt: `### ${hit.doc.citation} — ${hit.doc.title} (excerpt)\n\n${excerptAround(hit.doc.text, hit.index, 3500)}`, docCitation: hit.doc.citation });
  }
  log(`3a: ${repaired} repaired, ${localRejected} rejected locally, ${survivors.length} to verifier`);
  const results = await mapLimit(survivors, DIRECT.concurrency, async (s) => {
    const { statuteBlock, taskBlock } = verifyUserPrompt(s.item.citation.source, s.excerpt, {
      stem: s.item.stem, options: s.item.options, key: s.item.key, explanation: s.item.explanation, citation: s.item.citation, cognitive_level: s.item.cognitive_level,
    });
    const { data: v, result } = await chatJson(router, Verdict, [
      { role: "system", content: VERIFY_SYSTEM },
      { role: "user", content: `${statuteBlock}\n\n${taskBlock}` },
    ], { maxTokens: 2000, temperature: 0.1 });
    byProvider[`${result.provider}/${result.model}`] = (byProvider[`${result.provider}/${result.model}`] ?? 0) + 1;
    if (v.verdict === "pass") {
      const out: Item = { ...s.item, status: "verified", verified_on: today() };
      writeYaml(join(CONFIG.contentDir, "items", bank, s.item.blueprint_node.split(".")[0]!, `${s.item.id}.yaml`), out);
      unlinkSync(s.path);
      verified++;
    } else {
      reject(bank, s.item, [...v.issues, ...(v.suggested_fix ? [`fix: ${v.suggested_fix}`] : []), ...(v.suggested_key ? [`suggested_key: ${v.suggested_key}`] : []), `verifier: ${result.provider}/${result.model}`], s.path);
      rejected++;
    }
  });
  for (const r of results) if (!r.ok) { failed++; log(`  FAILED verify: ${String(r.error).slice(0, 300)}`); }
  return { drafts: drafts.length, localRejected, verified, rejected, failed, byProvider };
}
