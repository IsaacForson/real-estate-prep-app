/**
 * `pipeline plan <bank>` — compare blueprint targets with what exists, per node.
 */
import { join } from "node:path";
import { Blueprint, nodeTargets, type NodeTarget, type Item } from "@rep/schema";
import { loadItems, loadBlueprints } from "@rep/content-lint";
import { CONFIG } from "./config.js";

export interface NodeGap extends NodeTarget {
  existing: number;
  gap: number;
  byLevel: Record<"knowledge" | "application" | "analysis", number>;
}

export function loadBlueprint(bank: string): Blueprint {
  const { blueprints } = loadBlueprints(CONFIG.contentDir);
  const bp = blueprints.find((b) => b.value.id === bank)?.value;
  if (!bp) throw new Error(`no blueprint for ${bank} under ${join(CONFIG.contentDir, "blueprints")}`);
  return bp;
}

export function existingItems(bank: string): Item[] {
  const { items } = loadItems(CONFIG.contentDir);
  return items.map((x) => x.value).filter((i) => i.bank === bank);
}

export function planBank(bank: string, exam: "salesperson" | "broker" = "salesperson"): NodeGap[] {
  const bp = loadBlueprint(bank);
  const items = existingItems(bank);
  return nodeTargets(bp, exam).map((t) => {
    const mine = items.filter((i) => i.blueprint_node === t.node || i.blueprint_node.startsWith(t.node + "."));
    const byLevel = { knowledge: 0, application: 0, analysis: 0 };
    for (const i of mine) byLevel[i.cognitive_level]++;
    return { ...t, existing: mine.length, gap: Math.max(0, t.target_bank_items - mine.length), byLevel };
  });
}

/** Default cognitive mix when the blueprint does not publish one: 30/50/20. */
export function cognitiveMixFor(count: number, split?: Partial<Record<"knowledge" | "application" | "analysis", number | null>>) {
  const w = split && Object.values(split).some((v) => (v ?? 0) > 0)
    ? { knowledge: split.knowledge ?? 0, application: split.application ?? 0, analysis: split.analysis ?? 0 }
    : { knowledge: 0.3, application: 0.5, analysis: 0.2 };
  const total = w.knowledge + w.application + w.analysis;
  const k = Math.round((w.knowledge / total) * count);
  const a = Math.round((w.application / total) * count);
  const n = Math.max(0, count - k - a);
  return { knowledge: k, application: a, analysis: n };
}
