/** Client-side mock assembly (mirrors packages/pipeline/src/mocks.ts apportion): proportional draw per blueprint node. */
import type { Blueprint, Item } from "@rep/schema";
import { nodeTargets } from "@rep/schema";

export function apportionIds(bp: Blueprint, ids: string[], items: Item[], total: number, seed = Date.now()): string[] {
  const targets = nodeTargets(bp);
  const weightSum = targets.reduce((a, t) => a + t.exam_items, 0) || 1;
  const raw = targets.map((t) => (t.exam_items / weightSum) * total);
  const base = raw.map(Math.floor);
  let remaining = total - base.reduce((a, b) => a + b, 0);
  raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac).forEach(({ i }) => { if (remaining > 0) { base[i]!++; remaining--; } });
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const byId = new Map(items.map((i) => [i.id, i]));
  const used = new Set<string>(); const out: string[] = [];
  const sorted = targets.map((t, i) => ({ t, count: base[i]! })).sort((a, b) => b.t.node.length - a.t.node.length);
  for (const { t, count } of sorted) {
    const pool = ids.filter((id) => { const it = byId.get(id); return it && !used.has(id) && (it.blueprint_node === t.node || it.blueprint_node.startsWith(t.node + ".")); });
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
    for (const id of pool.slice(0, count)) { used.add(id); out.push(id); }
  }
  return out;
}
