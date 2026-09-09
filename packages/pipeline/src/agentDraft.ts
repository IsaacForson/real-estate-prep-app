/**
 * Agent drafting — items written directly by Claude agents (no external LLM API), against the same
 * cached authority text and schema the router path uses. Forson's 2026-09-09 decision: populate the
 * banks now with locally verified (verbatim quote + lint) items published as provisional; the model
 * verifier and human QA keep running behind and retire what they reject.
 *
 *   pipeline node-brief <bank> [--nodes I,II.A] [--max-chars 60000]   → .pipeline/briefs/<bank>/<node>.md
 *   pipeline import-drafts <bank> <file.json>                          → lint + quote-check, write passing drafts
 *   pipeline verify-local <bank>                                       → drafts passing 3a → content/items (status verified)
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { DraftItem, Item, keyIndex, type Item as ItemT } from "@rep/schema";
import { lintItems } from "@rep/content-lint";
import { CONFIG } from "./config.js";
import { readJson, readYaml, writeYaml, listFiles } from "./fsx.js";
import { loadStatutes, today } from "./statutes.js";
import { resolveRefs, locateQuote, refMatchesDoc } from "./cite.js";
import { planBank, existingItems, cognitiveMixFor } from "./plan.js";
import { bankMeta, nodeStatuteRefs, nextIdFactory, draftToItem } from "./draft.js";
import { stripExcludedSections } from "./direct.js";
import { normalizeDraft } from "./normalize.js";
import { localCheck, reject } from "./verify.js";

/** Several agents import for one bank at once; ids are bank-wide, so importing and verifying take a directory lock. */
function withLock<T>(bank: string, fn: () => T): T {
  const dir = join(CONFIG.stateDir, "locks"); mkdirSync(dir, { recursive: true });
  const lock = join(dir, `${bank}.lock`);
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { mkdirSync(lock); break; } catch { if (Date.now() > deadline) throw new Error(`lock timeout for ${bank}`); const until = Date.now() + 250; while (Date.now() < until) { /* spin */ } }
  }
  try { return fn(); } finally { try { rmdirSync(lock); } catch { /* ignore */ } }
}

const jurOf = (bank: string) => (bank.startsWith("national_") ? "NAT" : bank.replace(/^state_/, ""));

export function writeNodeBriefs(bank: string, opts: { nodes?: string[]; maxChars?: number } = {}): { files: string[]; summary: string[] } {
  const meta = bankMeta(bank);
  const docs = loadStatutes(meta.jur);
  if (!docs.length) throw new Error(`no statute text cached for ${meta.jur}`);
  const maxChars = opts.maxChars ?? 60_000;
  let gaps = planBank(bank).filter((g) => g.gap > 0);
  if (opts.nodes?.length) gaps = gaps.filter((g) => opts.nodes!.includes(g.node));
  const existing = existingItems(bank);
  const outDir = join(CONFIG.stateDir, "briefs", bank);
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [], summary: string[] = [];
  for (const g of gaps) {
    const refs = nodeStatuteRefs(bank, g.node);
    const r = refs.length ? resolveRefs(refs, docs) : { text: "", unmatched: refs, slugs: [], unsliced: [] };
    const stripped = stripExcludedSections(r.text);
    const text = stripped.text.length > maxChars ? stripped.text.slice(0, maxChars) + "\n\n[… authority text truncated for length …]" : stripped.text;
    const domain = g.node.split(".")[0]!;
    const nodeStems = existing.filter((i) => i.blueprint_node === g.node).map((i) => i.stem);
    const covered = [...new Set(existing.filter((i) => i.blueprint_node.split(".")[0] === domain).map((i) => i.options[keyIndex(i.key)]!))];
    const mix = cognitiveMixFor(g.gap, g.byLevel);
    const md = [
      `# ${bank} — node ${g.node}: ${g.label}`,
      ``,
      `- Jurisdiction: ${meta.name} · vendor: ${meta.vendor}`,
      `- This node contributes ${g.exam_items} scored item(s) to the real exam; bank target ${g.target_bank_items}, existing ${g.existing}, **write ${g.gap} items**.`,
      `- Cognitive mix for the gap: knowledge ${mix.knowledge}, application ${mix.application}, analysis ${mix.analysis}.`,
      `- Statute refs: ${refs.join("; ") || "(none — reference notes only)"}${r.unmatched.length ? `  (not cached: ${r.unmatched.join("; ")})` : ""}`,
      stripped.removed.length ? `- Excluded as non-examinable: ${stripped.removed.join(" | ")}` : ``,
      ``,
      `## Existing stems in this node (do not duplicate or lightly vary)`,
      nodeStems.length ? nodeStems.map((s) => `- ${s}`).join("\n") : `- none yet`,
      ``,
      `## Rules already covered in domain ${domain} (keyed answers — never ask these again in any wording)`,
      covered.length ? covered.map((s) => `- ${s}`).join("\n") : `- none yet`,
      ``,
      `## Authority text (cite only sections that appear here; citation.quoted_text must be verbatim)`,
      ``,
      text || "(no authority text resolved — skip this node)",
    ].filter((l) => l !== null).join("\n");
    const path = join(outDir, `${g.node}.md`);
    writeFileSync(path, md);
    files.push(path);
    summary.push(`${g.node}\t${g.label}\tgap=${g.gap}\tauthority=${text.length} chars${text ? "" : " (NONE)"}`);
  }
  return { files, summary };
}

interface ImportBatch { node: string; items: unknown[] }

/** JSON → lint/quote-checked draft YAML files. Returns what was written and what was refused (with reasons). */
export function importDrafts(bank: string, file: string): { written: string[]; refused: Array<{ node: string; stem: string; reasons: string[] }> } {
  return withLock(bank, () => importDraftsUnlocked(bank, file));
}
function importDraftsUnlocked(bank: string, file: string): { written: string[]; refused: Array<{ node: string; stem: string; reasons: string[] }> } {
  const raw = readJson<unknown>(file);
  const batches: ImportBatch[] = Array.isArray(raw) ? (raw as ImportBatch[]) : [raw as ImportBatch];
  const meta = bankMeta(bank);
  const docs = loadStatutes(meta.jur);
  const texts = docs.map((d) => d.text);
  const nextId = nextIdFactory(bank);
  const dir = join(CONFIG.stateDir, "drafts", bank);
  mkdirSync(dir, { recursive: true });
  const written: string[] = [], refused: Array<{ node: string; stem: string; reasons: string[] }> = [];
  const pending: ItemT[] = [];
  for (const b of batches) {
    if (!b || typeof b.node !== "string" || !Array.isArray(b.items)) throw new Error(`bad batch shape in ${file}: expected { node, items[] }`);
    for (const rawItem of b.items) {
      const parsed = DraftItem.safeParse(rawItem);
      if (!parsed.success) {
        refused.push({ node: b.node, stem: String((rawItem as { stem?: unknown })?.stem ?? "").slice(0, 90), reasons: parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`) });
        continue;
      }
      const item = normalizeDraft(draftToItem(parsed.data, { id: nextId(b.node), bank, node: b.node, model: "claude-agent", promptVersion: "agent-v1", batchId: null }), docs);
      const lc = localCheck(item, texts);
      const reasons = [...lc.reasons];
      if (lc.ok) {
        const hit = locateQuote(docs, item.citation.quoted_text);
        if (hit && !refMatchesDoc(item.citation.source, hit.doc.citation)) reasons.push(`citation.source "${item.citation.source}" does not correspond to the document containing the quote (${hit.doc.citation})`);
      }
      if (reasons.length) { refused.push({ node: b.node, stem: item.stem.slice(0, 90), reasons }); continue; }
      pending.push(item);
    }
  }
  // aggregate rules (near-duplicates against the bank) before anything is written
  const bankItems = [...existingItems(bank), ...listFiles(dir, ".yaml").map((p) => Item.parse(readYaml(p)))];
  const agg = lintItems([...bankItems, ...pending]).filter((f) => f.severity === "error" && pending.some((p) => p.id === f.subject) && /duplicate/.test(f.rule));
  const dupIds = new Set(agg.map((f) => f.subject));
  for (const it of pending) {
    if (dupIds.has(it.id)) { refused.push({ node: it.blueprint_node, stem: it.stem.slice(0, 90), reasons: agg.filter((f) => f.subject === it.id).map((f) => `lint:${f.rule}: ${f.message}`) }); continue; }
    writeYaml(join(dir, `${it.id}.yaml`), it);
    written.push(it.id);
  }
  return { written, refused };
}

/** 3a only: drafts passing the local checks become `verified` content (provisional), the rest are rejected with reasons. */
export function verifyLocal(bank: string): { verified: number; rejected: number } {
  return withLock(bank, () => verifyLocalUnlocked(bank));
}
function verifyLocalUnlocked(bank: string): { verified: number; rejected: number } {
  const drafts = listFiles(join(CONFIG.stateDir, "drafts", bank), ".yaml");
  if (!drafts.length) return { verified: 0, rejected: 0 };
  const docs = loadStatutes(jurOf(bank));
  const texts = docs.map((d) => d.text);
  let verified = 0, rejected = 0;
  for (const path of drafts) {
    const parsed = Item.safeParse(readYaml(path));
    if (!parsed.success) { rejected++; continue; }
    const item = normalizeDraft(parsed.data, docs);
    const lc = localCheck(item, texts);
    if (!lc.ok) { reject(bank, item, lc.reasons, path); rejected++; continue; }
    const hit = locateQuote(docs, item.citation.quoted_text);
    if (hit && !refMatchesDoc(item.citation.source, hit.doc.citation)) { reject(bank, item, [`citation.source does not correspond to ${hit.doc.citation}`], path); rejected++; continue; }
    const out: ItemT = { ...item, status: "verified", verified_on: today(), review_reason: "provisional: agent-drafted, local checks only (quote verbatim + lint); model verifier and QA pending" };
    const target = join(CONFIG.contentDir, "items", bank, item.blueprint_node.split(".")[0]!);
    mkdirSync(target, { recursive: true });
    writeYaml(join(target, `${item.id}.yaml`), out);
    if (existsSync(path)) unlinkSync(path);
    verified++;
  }
  return { verified, rejected };
}
