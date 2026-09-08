/**
 * Step 2 — DRAFT. Builds one Message Batch per bank run. Each request drafts `itemsPerCall`
 * items for one blueprint node with the node's statute text in a cached block.
 *
 *   pipeline draft <bank> [--nodes I,II] [--limit N]     → submits batch, writes manifest
 *   pipeline collect <batchId>                            → pulls results into .pipeline/drafts
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { join } from "node:path";
import { DraftItem, JURISDICTIONS, isJurisdictionCode, type Item, type JurisdictionCode } from "@rep/schema";
import { CONFIG } from "./config.js";
import { writeJson, readJson, writeYaml, readYaml, listFiles } from "./fsx.js";
import { loadStatutes, today } from "./statutes.js";
import { resolveRefs } from "./cite.js";
import { planBank, cognitiveMixFor, existingItems, loadBlueprint, type NodeGap } from "./plan.js";
import { DRAFT_SYSTEM, draftUserPrompt } from "./prompts.js";
import { StateRecord } from "@rep/schema";

export const DraftBatchSchema = z.object({ items: z.array(DraftItem) });

export interface BatchManifest {
  batch_id: string;
  kind: "draft" | "verify";
  bank: string;
  model: string;
  prompt_version: string;
  created: string;
  requests: Array<{ custom_id: string; node: string; count: number; statute_slugs: string[] }>;
}

export function jurisdictionOf(bank: string): "NAT" | JurisdictionCode {
  if (!bank.startsWith("state_")) return "NAT";
  const j = bank.slice(6);
  if (!isJurisdictionCode(j)) throw new Error(`bad bank ${bank}`);
  return j;
}

export function bankMeta(bank: string) {
  const jur = jurisdictionOf(bank);
  if (jur === "NAT") {
    return { jur, name: "United States (national portion)", vendor: bank === "national_psi" ? "psi" : "pearsonvue", statuteRoot: "Federal law (Fair Housing Act, RESPA, TILA/Reg Z, ECOA, CERCLA) and general principles" };
  }
  if (!isJurisdictionCode(jur)) throw new Error(`bad bank ${bank}`);
  const st = StateRecord.parse(readYaml(join(CONFIG.contentDir, "states", `${jur}.yaml`)));
  return { jur, name: JURISDICTIONS[jur], vendor: st.vendor, statuteRoot: [st.statute_citation_root, st.rules_citation_root].filter(Boolean).join("; ") };
}

/** Resolve a node's statute_refs to the text it will be drafted from (see cite.ts). */
export function statuteTextFor(jur: string, refs: string[]): { text: string; slugs: string[] } {
  const docs = loadStatutes(jur);
  if (!docs.length) throw new Error(`no statute text cached for ${jur}: run 'pipeline ingest' first — drafting without ground truth is not allowed`);
  if (!refs.length) throw new Error(`blueprint node has no statute_refs for ${jur}; add refs before drafting (every node must name its authorities)`);
  const r = resolveRefs(refs, docs);
  if (!r.text) throw new Error(`no cached authority for ${jur} matches statute_refs [${refs.join(", ")}]. Cached: ${docs.map((d) => d.citation).join(" | ")}`);
  if (r.unmatched.length) console.warn(`warn: refs not cached for ${jur}: ${r.unmatched.join(", ")}`);
  if (r.unsliced.length) console.warn(`warn: section not found, whole document sent for: ${r.unsliced.join(", ")}`);
  const cap = Number(process.env.DRAFT_MAX_STATUTE_CHARS ?? 400_000); // ≈ 100K tokens, cached per node
  if (r.text.length > cap)
    throw new Error(`authority text for ${jur} node is ${r.text.length} chars (${r.slugs.join(", ")}); cap is ${cap}. Use section-level statute_refs on the blueprint node, or raise DRAFT_MAX_STATUTE_CHARS.`);
  return { text: r.text, slugs: r.slugs };
}

export async function submitDraftBatch(bank: string, opts: { nodes?: string[]; limit?: number; dryRun?: boolean } = {}): Promise<BatchManifest> {
  const meta = bankMeta(bank);
  let gaps: NodeGap[] = planBank(bank).filter((g) => g.gap > 0);
  if (opts.nodes?.length) gaps = gaps.filter((g) => opts.nodes!.includes(g.node));
  const existing = existingItems(bank);
  const requests: Anthropic.Messages.Batches.BatchCreateParams["requests"] = [];
  const manifestReqs: BatchManifest["requests"] = [];

  for (const g of gaps) {
    const refs = nodeStatuteRefs(bank, g.node);
    const { text, slugs } = statuteTextFor(meta.jur, refs);
    const stems = existing.filter((i) => i.blueprint_node.startsWith(g.node)).map((i) => i.stem);
    let remaining = Math.min(g.gap, opts.limit ?? g.gap);
    let call = 0;
    while (remaining > 0) {
      const count = Math.min(CONFIG.itemsPerCall, remaining);
      const { statuteBlock, taskBlock } = draftUserPrompt({
        bank, jurisdictionName: meta.name, vendor: meta.vendor, target: g, count,
        cognitiveMix: cognitiveMixFor(count, g.cognitive_split), statuteCitationRoot: meta.statuteRoot,
        statuteText: text, existingStems: stems.slice(0, 60),
      });
      const custom_id = `${bank}|${g.node}|${call++}`;
      requests.push({
        custom_id,
        params: {
          model: CONFIG.model,
          max_tokens: 16000,
          system: [{ type: "text", text: DRAFT_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [{
            role: "user",
            content: [
              { type: "text", text: statuteBlock, cache_control: { type: "ephemeral" } },
              { type: "text", text: taskBlock },
            ],
          }],
          output_config: { format: zodOutputFormat(DraftBatchSchema) },
        },
      });
      manifestReqs.push({ custom_id, node: g.node, count, statute_slugs: slugs });
      remaining -= count;
    }
  }
  if (!requests.length) throw new Error(`nothing to draft for ${bank}: all nodes at target`);

  if (opts.dryRun) {
    const id = `dryrun_${bank}_${Date.now()}`;
    writeJson(join(CONFIG.stateDir, "dry-run", `${id}.json`), { requests });
    const chars = requests.reduce((a, r) => a + JSON.stringify(r.params).length, 0);
    console.log(`dry run: ${requests.length} requests, ~${Math.round(chars / 4).toLocaleString()} input tokens total (before caching) → .pipeline/dry-run/${id}.json`);
    return { batch_id: id, kind: "draft", bank, model: CONFIG.model, prompt_version: CONFIG.promptVersion, created: new Date().toISOString(), requests: manifestReqs };
  }
  const client = new Anthropic();
  const batch = await client.messages.batches.create({ requests });
  const manifest: BatchManifest = { batch_id: batch.id, kind: "draft", bank, model: CONFIG.model, prompt_version: CONFIG.promptVersion, created: new Date().toISOString(), requests: manifestReqs };
  writeJson(join(CONFIG.stateDir, "batches", `${batch.id}.json`), manifest);
  return manifest;
}

export function nodeStatuteRefs(bank: string, node: string): string[] {
  const bp = loadBlueprint(bank);
  for (const exam of Object.values(bp.exams)) {
    if (!exam) continue;
    for (const d of exam.domains) {
      if (d.id === node) return d.subtopics.flatMap((s) => s.statute_refs);
      const s = d.subtopics.find((x) => x.id === node);
      if (s) return s.statute_refs;
    }
  }
  return [];
}

/** Sequence numbers per bank/root so ids stay stable and unique across runs. */
export function nextIdFactory(bank: string) {
  const jur = jurisdictionOf(bank);
  const root = jur === "NAT" ? (bank === "national_psi" ? "PSI" : "PV") : rootFor(jur);
  const existing = existingItems(bank);
  const drafts = collectedDraftIds(bank);
  let max = 0;
  for (const id of [...existing.map((i) => i.id), ...drafts]) {
    const n = Number(id.split("-").pop());
    if (n > max) max = n;
  }
  return (node: string) => {
    max++;
    const mid = jur === "NAT" ? `${root}-${node.split(".")[0]}` : root;
    return `${jur}-${mid}-${String(max).padStart(4, "0")}`;
  };
}

function rootFor(jur: string): string {
  const st = StateRecord.parse(readYaml(join(CONFIG.contentDir, "states", `${jur}.yaml`)));
  const m = st.statute_citation_root?.match(/(\d+[A-Z]?)(?!.*\d)/);
  return (m?.[1] ?? "LAW").toUpperCase();
}

function collectedDraftIds(bank: string): string[] {
  const dir = join(CONFIG.stateDir, "drafts", bank);
  return listFiles(dir, ".yaml").map((p) => p.split("/").pop()!.replace(/\.yaml$/, ""));
}

export async function collectBatch(batchId: string): Promise<{ written: number; failed: number }> {
  const client = new Anthropic();
  const manifest = readJson<BatchManifest>(join(CONFIG.stateDir, "batches", `${batchId}.json`));
  const batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status !== "ended") throw new Error(`batch ${batchId} is ${batch.processing_status}; try again later`);
  const nextId = nextIdFactory(manifest.bank);
  const byId = new Map(manifest.requests.map((r) => [r.custom_id, r]));
  let written = 0, failed = 0;
  for await (const result of await client.messages.batches.results(batchId)) {
    const req = byId.get(result.custom_id)!;
    if (result.result.type !== "succeeded") { failed++; console.error(`[${result.custom_id}] ${result.result.type}`); continue; }
    const msg = result.result.message;
    if (msg.stop_reason === "refusal") { failed++; console.error(`[${result.custom_id}] refusal: ${msg.stop_details?.explanation ?? ""}`); continue; }
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const parsed = DraftBatchSchema.safeParse(safeJson(text));
    if (!parsed.success) { failed++; console.error(`[${result.custom_id}] bad JSON: ${parsed.error.issues[0]?.message}`); continue; }
    for (const d of parsed.data.items) {
      const id = nextId(req.node);
      const item = draftToItem(d, { id, bank: manifest.bank, node: req.node, model: manifest.model, promptVersion: manifest.prompt_version, batchId });
      writeYaml(join(CONFIG.stateDir, "drafts", manifest.bank, `${id}.yaml`), item);
      written++;
    }
  }
  return { written, failed };
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

/** Stamp a model draft into a full Item (status draft) — shared by the Batches and direct paths. */
export function draftToItem(d: DraftItem, meta: { id: string; bank: string; node: string; model: string; promptVersion: string; batchId: string | null }): Item {
  const vendor: Item["vendor"] = meta.bank === "national_psi" ? "psi" : meta.bank === "national_pearsonvue" ? "pearsonvue" : (bankMeta(meta.bank).vendor as Item["vendor"]);
  return {
    id: meta.id, jurisdiction: jurisdictionOf(meta.bank), bank: meta.bank, blueprint_node: meta.node, vendor,
    license_level: "both", cognitive_level: d.cognitive_level, stem: d.stem, options: d.options, key: d.key,
    explanation: d.explanation,
    citation: { source: d.citation.source, url: null, quoted_text: d.citation.quoted_text, secondary: [] },
    ...(d.math ? { math: { worked_solution: d.math.worked_solution, formulas: d.math.formulas, onscreen_calculator_only: false } } : {}),
    terms: d.terms, tags: [], status: "draft", reviewer: null, verified_on: null, qa_approved_on: null, version: 1,
    provenance: { model: meta.model, prompt_version: meta.promptVersion, batch_id: meta.batchId, generated_on: today() },
  };
}
