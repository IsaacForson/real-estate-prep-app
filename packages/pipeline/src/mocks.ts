/**
 * F11 — full-length timed mocks in exact state format.
 *   pipeline mock-build <XX> [--forms 5] [--status published|verified]
 * Builds N non-overlapping forms per jurisdiction: a national section drawn from the state's
 * routed national bank (item count from the state record, weights from the national blueprint)
 * plus a state section from the state blueprint. Refuses to build if the bank cannot supply the
 * items — that shortfall report is the per-state "ready for mocks" gate.
 */
import { join } from "node:path";
import { Item, StateRecord, JURISDICTIONS, isJurisdictionCode, nationalBankFor, nodeTargets, type Blueprint, type NodeTarget } from "@rep/schema";
import { loadItems, loadBlueprints } from "@rep/content-lint";
import { CONFIG } from "./config.js";
import { readYaml, writeYaml } from "./fsx.js";
import { today } from "./statutes.js";

export interface Allocation { node: string; count: number }

/** Largest-remainder apportionment of `total` items across nodes weighted by exam_items. */
export function apportion(targets: NodeTarget[], total: number): Allocation[] {
  const weightSum = targets.reduce((a, t) => a + t.exam_items, 0);
  if (!weightSum || total <= 0) return targets.map((t) => ({ node: t.node, count: 0 }));
  const raw = targets.map((t) => (t.exam_items / weightSum) * total);
  const base = raw.map(Math.floor);
  let remaining = total - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) { if (remaining <= 0) break; base[i]!++; remaining--; }
  return targets.map((t, i) => ({ node: t.node, count: base[i]! }));
}

export interface Shortfall { node: string; need: number; have: number }

/**
 * Deal items into `forms` non-overlapping sets following an allocation. Deterministic given
 * `seed`; items are grouped by node prefix match so subtopic-tagged items satisfy domain nodes.
 */
export function dealForms(items: Item[], alloc: Allocation[], forms: number, seed = 1): { forms: string[][]; shortfalls: Shortfall[] } {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  const used = new Set<string>();
  const out: string[][] = Array.from({ length: forms }, () => []);
  const shortfalls: Shortfall[] = [];
  // Most specific nodes first so a subtopic node does not get starved by its parent domain.
  const sorted = [...alloc].sort((a, b) => b.node.length - a.node.length);
  for (const { node, count } of sorted) {
    const pool = shuffle(items.filter((i) => !used.has(i.id) && (i.blueprint_node === node || i.blueprint_node.startsWith(node + "."))));
    const need = count * forms;
    if (pool.length < need) shortfalls.push({ node, need, have: pool.length });
    let k = 0;
    for (let f = 0; f < forms; f++) for (let c = 0; c < count; c++) { const it = pool[k++]; if (!it) break; out[f]!.push(it.id); used.add(it.id); }
  }
  return { forms: out, shortfalls };
}

export interface MockForm {
  id: string;
  jurisdiction: string;
  form: number;
  built_on: string;
  time_minutes: number | null;
  grading: "combined" | "separate" | null;
  sections: Array<{ portion: "national" | "state"; bank: string; items: string[]; pass_score: string | null }>;
}

export function buildMocks(code: string, forms = 5, status: Item["status"] = "published"): { written: string[]; shortfalls: Record<string, Shortfall[]> } {
  if (!isJurisdictionCode(code)) throw new Error(`unknown jurisdiction ${code}`);
  const st = StateRecord.parse(readYaml(join(CONFIG.contentDir, "states", `${code}.yaml`)));
  const { blueprints } = loadBlueprints(CONFIG.contentDir);
  const bp = (id: string): Blueprint | undefined => blueprints.find((b) => b.value.id === id)?.value;
  const all = loadItems(CONFIG.contentDir).items.map((x) => x.value).filter((i) => i.status === status || (status === "verified" && i.status !== "draft"));

  const sections: Array<{ portion: "national" | "state"; bank: string; count: number; blueprint: Blueprint | undefined; pass: string | null }> = [];
  const natBank = nationalBankFor(st.vendor);
  const se = st.salesperson_exam;
  if (natBank && se.national_items) sections.push({ portion: "national", bank: natBank, count: se.national_items, blueprint: bp(natBank), pass: se.pass_score_national });
  const stateCount = se.state_items ?? (natBank ? null : se.total_items);
  if (stateCount) sections.push({ portion: "state", bank: `state_${code}`, count: stateCount, blueprint: bp(`state_${code}`), pass: se.pass_score_state ?? se.pass_score_combined });
  if (!sections.length) throw new Error(`${code}: state record has no item counts; cannot build a mock`);

  const dealt = sections.map((sec) => {
    if (!sec.blueprint) throw new Error(`${code}: missing blueprint ${sec.bank}`);
    const alloc = apportion(nodeTargets(sec.blueprint), sec.count);
    const items = all.filter((i) => i.bank === sec.bank);
    return { sec, ...dealForms(items, alloc, forms, code.charCodeAt(0) * 131 + forms) };
  });

  const shortfalls: Record<string, Shortfall[]> = {};
  for (const d of dealt) if (d.shortfalls.length) shortfalls[d.sec.bank] = d.shortfalls;
  if (Object.keys(shortfalls).length) return { written: [], shortfalls };

  const written: string[] = [];
  for (let f = 0; f < forms; f++) {
    const form: MockForm = {
      id: `${code}-MOCK-${String(f + 1).padStart(2, "0")}`, jurisdiction: code, form: f + 1, built_on: today(),
      time_minutes: se.time_minutes, grading: se.grading,
      sections: dealt.map((d) => ({ portion: d.sec.portion, bank: d.sec.bank, items: d.forms[f]!, pass_score: d.sec.pass })),
    };
    const path = join(CONFIG.contentDir, "mocks", code, `form-${String(f + 1).padStart(2, "0")}.yaml`);
    writeYaml(path, form);
    written.push(path);
  }
  console.log(`${JURISDICTIONS[code]}: ${forms} forms × ${sections.map((s) => `${s.count} ${s.portion}`).join(" + ")}`);
  return { written, shortfalls };
}
