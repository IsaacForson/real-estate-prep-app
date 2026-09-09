/**
 * Step 5/6 — HUMAN QA and PUBLISH.
 *   pipeline qa-sheet <bank> [--sample 0.2]   → writes a reviewer CSV of verified items to .pipeline/qa/
 *   pipeline qa-approve <reviewer_id> <id...>  → stamps items qa_approved
 *   pipeline qa-reject  <reviewer_id> <id> "<reason>" → retires item to .pipeline/rejected
 *   pipeline publish <bank>                    → flips qa_approved → published
 * Sampled, not 100% (SPEC §3.5). The sample must be random per batch, never the first N.
 */
import { join } from "node:path";
import { Item, domainOf } from "@rep/schema";
import { loadItems } from "@rep/content-lint";
import { CONFIG } from "./config.js";
import { writeText, writeYaml } from "./fsx.js";
import { today } from "./statutes.js";
import { unlinkSync } from "node:fs";

function bankItems(bank: string, status?: Item["status"]) {
  return loadItems(CONFIG.contentDir).items.filter((x) => x.value.bank === bank && (!status || x.value.status === status));
}

function itemPath(item: Item) {
  return join(CONFIG.contentDir, "items", item.bank, domainOf(item.blueprint_node), `${item.id}.yaml`);
}

export function qaSheet(bank: string, sample = 0.2, seed = Date.now()): string {
  const items = bankItems(bank, "verified");
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const chosen = items.filter(() => rnd() < sample);
  const esc = (v: string) => `"${v.replace(/"/g, '""').replace(/\n/g, " ")}"`;
  const rows = [
    ["id", "node", "level", "stem", "A", "B", "C", "D", "key", "explanation", "citation", "quoted_text", "reviewer_verdict (approve/reject)", "reviewer_notes"].join(","),
    ...chosen.map(({ value: i }) => [i.id, i.blueprint_node, i.cognitive_level, i.stem, ...i.options, i.key, i.explanation, i.citation.source, i.citation.quoted_text, "", ""].map(esc).join(",")),
  ];
  const path = join(CONFIG.stateDir, "qa", `${bank}-${today()}-${seed}.csv`);
  writeText(path, rows.join("\n") + "\n");
  console.log(`${chosen.length}/${items.length} verified items sampled → ${path}`);
  return path;
}

export function qaApprove(reviewer: string, ids: string[]) {
  const all = loadItems(CONFIG.contentDir).items;
  for (const id of ids) {
    const hit = all.find((x) => x.value.id === id);
    if (!hit) { console.error(`${id}: not found`); continue; }
    if (hit.value.status !== "verified") { console.error(`${id}: status is ${hit.value.status}, expected verified`); continue; }
    const out: Item = { ...hit.value, status: "qa_approved", reviewer, qa_approved_on: today() };
    writeYaml(itemPath(out), out);
  }
}

export function qaReject(reviewer: string, id: string, reason: string) {
  const hit = loadItems(CONFIG.contentDir).items.find((x) => x.value.id === id);
  if (!hit) throw new Error(`${id}: not found`);
  writeYaml(join(CONFIG.stateDir, "rejected", hit.value.bank, `${id}.yaml`), { ...hit.value, status: "retired", rejection: { on: today(), by: reviewer, reasons: [reason] } });
  unlinkSync(itemPath(hit.value));
}

export function publish(bank: string, statuses: Array<Item["status"]> = ["qa_approved"]): number {
  let n = 0;
  for (const status of statuses) {
    const items = bankItems(bank, status);
    for (const { value } of items) {
      writeYaml(itemPath(value), { ...value, status: "published" });
      n++;
    }
  }
  return n;
}
