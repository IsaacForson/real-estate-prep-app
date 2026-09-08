/**
 * Step 3 — VERIFY. Two gates, both must pass:
 *   3a (automated, local):  citation.quoted_text appears verbatim in the cached statute text,
 *                           and the item passes content-lint per-item rules.
 *   3b (model, batched):    an independent verifier sees the STATUTE TEXT + the item and returns
 *                           pass/fail. It never sees only the explanation.
 * Passing items move to content/items/<bank>/<domain>/<id>.yaml with status "verified".
 * Failing items go to .pipeline/rejected/<bank>/<id>.yaml with the reasons attached.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { join } from "node:path";
import { Item, domainOf } from "@rep/schema";
import { lintItem } from "@rep/content-lint";
import { CONFIG } from "./config.js";
import { listFiles, readYaml, writeYaml, writeJson, readJson } from "./fsx.js";
import { loadStatutes, quoteAppears, today } from "./statutes.js";
import { locateQuote, excerptAround, refMatchesDoc } from "./cite.js";
import { VERIFY_SYSTEM, verifyUserPrompt } from "./prompts.js";
import type { BatchManifest } from "./draft.js";
import { unlinkSync } from "node:fs";

export const Verdict = z.object({
  verdict: z.enum(["pass", "fail"]),
  quoted_text_found: z.boolean(),
  key_supported: z.boolean(),
  citation_precise: z.boolean(),
  stem_clear: z.boolean(),
  issues: z.array(z.string()),
  suggested_fix: z.string().nullable(),
  suggested_key: z.enum(["A", "B", "C", "D"]).nullable(),
});
export type Verdict = z.infer<typeof Verdict>;

export function jurOf(bank: string) { return bank.startsWith("state_") ? bank.slice(6) : "NAT"; }

export interface LocalCheck { ok: boolean; reasons: string[] }

/** Gate 3a. Pure; testable without network. */
export function localCheck(item: Item, statuteTexts: string[]): LocalCheck {
  const reasons: string[] = [];
  if (!statuteTexts.some((t) => quoteAppears(item.citation.quoted_text, t))) reasons.push("quoted_text not found verbatim in cached statute text");
  if (!/§|sec\.|section|rule|r\.|ref\./i.test(item.citation.source)) reasons.push("citation.source does not name a section");
  for (const f of lintItem(item)) if (f.severity === "error") reasons.push(`lint:${f.rule}: ${f.message}`);
  return { ok: reasons.length === 0, reasons };
}

export function reject(bank: string, item: Item, reasons: string[], from?: string) {
  writeYaml(join(CONFIG.stateDir, "rejected", bank, `${item.id}.yaml`), { ...item, rejection: { on: today(), reasons } });
  if (from) unlinkSync(from);
}

/** Runs 3a over all drafts for a bank, then submits a verify batch for survivors. */
export async function submitVerifyBatch(bank: string): Promise<BatchManifest | null> {
  const drafts = listFiles(join(CONFIG.stateDir, "drafts", bank), ".yaml");
  if (!drafts.length) throw new Error(`no drafts for ${bank}; run 'pipeline collect <batchId>' first`);
  const jur = jurOf(bank);
  const statutes = loadStatutes(jur);
  const texts = statutes.map((s) => s.text);
  const requests: Anthropic.Messages.Batches.BatchCreateParams["requests"] = [];
  const manifestReqs: BatchManifest["requests"] = [];
  let localRejected = 0;

  for (const path of drafts) {
    const parsed = Item.safeParse(readYaml(path));
    if (!parsed.success) { console.error(`${path}: schema invalid — ${parsed.error.issues[0]?.message}`); continue; }
    const item = parsed.data;
    const lc = localCheck(item, texts);
    if (!lc.ok) { reject(bank, item, lc.reasons, path); localRejected++; continue; }
    // The verifier sees the section that actually contains the quote (plus the cited doc's identity),
    // never the whole jurisdiction corpus — cheaper, and it cannot be rescued by unrelated text.
    const hit = locateQuote(statutes, item.citation.quoted_text)!;
    if (!refMatchesDoc(item.citation.source, hit.doc.citation)) { reject(bank, item, [`citation.source "${item.citation.source}" does not correspond to the document containing the quote (${hit.doc.citation})`], path); localRejected++; continue; }
    const excerpt = `### ${hit.doc.citation} — ${hit.doc.title} (excerpt)\n\n${excerptAround(hit.doc.text, hit.index)}`;
    const { statuteBlock, taskBlock } = verifyUserPrompt(item.citation.source, excerpt, {
      stem: item.stem, options: item.options, key: item.key, explanation: item.explanation, citation: item.citation, cognitive_level: item.cognitive_level,
    });
    requests.push({
      custom_id: item.id,
      params: {
        model: CONFIG.model,
        max_tokens: 4000,
        system: [{ type: "text", text: VERIFY_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: statuteBlock, cache_control: { type: "ephemeral" } }, { type: "text", text: taskBlock }] }],
        output_config: { format: zodOutputFormat(Verdict) },
      },
    });
    manifestReqs.push({ custom_id: item.id, node: item.blueprint_node, count: 1, statute_slugs: [hit.doc.slug] });
  }
  console.log(`3a: ${localRejected} rejected locally, ${requests.length} sent to verifier`);
  if (!requests.length) return null;
  const client = new Anthropic();
  const batch = await client.messages.batches.create({ requests });
  const manifest: BatchManifest = { batch_id: batch.id, kind: "verify", bank, model: CONFIG.model, prompt_version: CONFIG.promptVersion, created: new Date().toISOString(), requests: manifestReqs };
  writeJson(join(CONFIG.stateDir, "batches", `${batch.id}.json`), manifest);
  return manifest;
}

export async function collectVerifyBatch(batchId: string): Promise<{ verified: number; rejected: number }> {
  const client = new Anthropic();
  const manifest = readJson<BatchManifest>(join(CONFIG.stateDir, "batches", `${batchId}.json`));
  if (manifest.kind !== "verify") throw new Error(`${batchId} is a ${manifest.kind} batch`);
  const batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status !== "ended") throw new Error(`batch ${batchId} is ${batch.processing_status}`);
  let verified = 0, rejected = 0;
  for await (const result of await client.messages.batches.results(batchId)) {
    const draftPath = join(CONFIG.stateDir, "drafts", manifest.bank, `${result.custom_id}.yaml`);
    const item = Item.parse(readYaml(draftPath));
    if (result.result.type !== "succeeded") { console.error(`[${result.custom_id}] ${result.result.type} — left in drafts for retry`); continue; }
    const msg = result.result.message;
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    let v: Verdict;
    try { v = Verdict.parse(JSON.parse(text)); } catch { console.error(`[${result.custom_id}] unparseable verdict — left in drafts`); continue; }
    if (v.verdict === "pass") {
      const out: Item = { ...item, status: "verified", verified_on: today(), version: item.version };
      writeYaml(join(CONFIG.contentDir, "items", manifest.bank, domainOf(item.blueprint_node), `${item.id}.yaml`), out);
      unlinkSync(draftPath);
      verified++;
    } else {
      reject(manifest.bank, item, [...v.issues, ...(v.suggested_fix ? [`fix: ${v.suggested_fix}`] : []), ...(v.suggested_key ? [`suggested_key: ${v.suggested_key}`] : [])], draftPath);
      rejected++;
    }
  }
  return { verified, rejected };
}
