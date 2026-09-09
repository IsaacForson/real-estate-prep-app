/**
 * `pipeline forms-build <bank|XX> [--remote] [--forms 5]` — assemble non-overlapping mock forms from
 * approved (qa_approved / published) items and upsert them into `mock_forms` (migration 0021) so
 * `mock-start` serves a fixed, real form instead of drawing fresh.
 *
 *   national_pearsonvue | national_psi   `short` = 20 items / 30 min, `full` = the blueprint's scored
 *                                        item count (80) / the vendor's typical national time; more
 *                                        `full-N` forms while the bank still has unused items
 *   XX (a state)                         the state's exam format from content/states/XX.yaml:
 *                                        `short` (20 items in the exam's proportions) + `form-1..N`
 *                                        full-length forms (national + state sections)
 *
 * Assembly reuses mocks.ts: per-node apportionment of the blueprint, then dealing without reuse. A
 * node the bank cannot yet cover is topped up from the bank's other nodes — real items, proportions
 * slightly off, reported in the notes. A form whose full size cannot be met is not built at all;
 * nothing is ever padded or invented.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { type Blueprint, Item, isJurisdictionCode, JURISDICTIONS, nationalBankFor, nodeTargets, StateRecord } from "@rep/schema";
import { loadBlueprints, loadItems } from "@rep/content-lint";
import { CONFIG } from "./config.js";
import { readYaml } from "./fsx.js";
import { apportion, dealForms } from "./mocks.js";
import { PUBLISHABLE, remoteFromEnv, type SupabaseRemote } from "./remote.js";

export const SHORT_FORM_ID = "short";
export const SHORT_FORM_ITEMS = 20;
export const SHORT_FORM_MINUTES = 30;
/** National-portion defaults when a state record does not say otherwise. */
export const NATIONAL_DEFAULTS: Record<"national_pearsonvue" | "national_psi", { minutes: number; pass: number; label: string }> = {
  national_pearsonvue: { minutes: 150, pass: 0.7, label: "Pearson VUE" },
  national_psi: { minutes: 120, pass: 0.7, label: "PSI" },
};

export interface SectionSpec {
  portion: "national" | "state";
  bank: string;
  count: number;
  blueprint: Blueprint;
  /** vendor wording, e.g. "75%" or "56/80"; shown to the learner per portion */
  pass: string | null;
}
export interface FormSpec {
  form_id: string;
  title: string;
  time_minutes: number;
  /** 0..1 — what the mock reports as pass/below overall */
  pass_score: number;
  sections: SectionSpec[];
}

export interface BuiltPortion { portion: "national" | "state"; bank: string; item_ids: string[]; pass_score: string | null }
export interface BuiltForm {
  form_id: string;
  title: string;
  time_limit_s: number;
  pass_score: number;
  item_ids: string[];
  portions: BuiltPortion[];
}
export interface AssembleResult { forms: BuiltForm[]; skipped: { form_id: string; reason: string }[]; notes: string[] }

/** Deterministic seed per target so a rebuild with unchanged items yields the same forms. */
export function seedFor(target: string): number {
  let h = 2166136261;
  for (const ch of target) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h || 1;
}

/**
 * Deal every spec in order from one shared pool: an item used by one form is never used by another
 * built for the same target. Specs whose full size the pool cannot meet are skipped, not shrunk.
 */
export function assembleForms(items: Item[], specs: FormSpec[], seed = 1): AssembleResult {
  const approved = items.filter((i) => PUBLISHABLE.has(i.status));
  const used = new Set<string>();
  const forms: BuiltForm[] = [];
  const skipped: AssembleResult["skipped"] = [];
  const notes: string[] = [];
  let salt = 0;

  for (const spec of specs) {
    const portions: BuiltPortion[] = [];
    const reserved: string[] = [];
    let reason: string | null = null;
    for (const sec of spec.sections) {
      const pool = approved.filter((i) => i.bank === sec.bank && !used.has(i.id) && !reserved.includes(i.id));
      if (pool.length < sec.count) {
        reason = `${sec.bank}: need ${sec.count} unused items, have ${pool.length}`;
        break;
      }
      const alloc = apportion(nodeTargets(sec.blueprint), sec.count);
      const dealt = dealForms(pool, alloc, 1, seed + salt++);
      const ids = [...(dealt.forms[0] ?? [])];
      const dealtCount = ids.length;
      if (ids.length < sec.count) {
        // top up from the bank's other nodes; still real, approved items
        const have = new Set(ids);
        const rest = pool.filter((i) => !have.has(i.id));
        // stable but seed-dependent order
        let s = (seed + salt) >>> 0;
        const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
        for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j]!, rest[i]!]; }
        for (const it of rest) { if (ids.length >= sec.count) break; ids.push(it.id); }
        const short = dealt.shortfalls.map((x) => `${x.node} ${x.have}/${x.need}`).join(", ");
        notes.push(`${spec.form_id} ${sec.bank}: ${ids.length - dealtCount} of ${sec.count} outside the blueprint proportions (thin nodes: ${short})`);
      }
      portions.push({ portion: sec.portion, bank: sec.bank, item_ids: ids, pass_score: sec.pass });
      reserved.push(...ids);
    }
    if (reason) { skipped.push({ form_id: spec.form_id, reason }); continue; }
    for (const id of reserved) used.add(id);
    forms.push({
      form_id: spec.form_id,
      title: spec.title,
      time_limit_s: spec.time_minutes * 60,
      pass_score: spec.pass_score,
      item_ids: portions.flatMap((p) => p.item_ids),
      portions,
    });
  }
  return { forms, skipped, notes };
}

function bp(blueprints: Blueprint[], id: string): Blueprint {
  const b = blueprints.find((x) => x.id === id);
  if (!b) throw new Error(`missing blueprint ${id} in content/blueprints`);
  return b;
}

/** Specs for a national bank: `short`, `full`, then `full-2`… while unused items remain. */
export function nationalSpecs(bank: "national_pearsonvue" | "national_psi", blueprints: Blueprint[], approvedCount: number): FormSpec[] {
  const b = bp(blueprints, bank);
  const d = NATIONAL_DEFAULTS[bank];
  const full = b.exams.salesperson.scored_items;
  const passLabel = `${Math.round(d.pass * 100)}%`;
  const specs: FormSpec[] = [
    { form_id: SHORT_FORM_ID, title: `Short national mock · ${d.label}`, time_minutes: SHORT_FORM_MINUTES, pass_score: d.pass, sections: [{ portion: "national", bank, count: SHORT_FORM_ITEMS, blueprint: b, pass: passLabel }] },
  ];
  let left = approvedCount - SHORT_FORM_ITEMS;
  for (let n = 1; left >= full; n++, left -= full) {
    specs.push({ form_id: n === 1 ? "full" : `full-${n}`, title: `Full national mock${n > 1 ? ` ${n}` : ""} · ${d.label} (${full} questions)`, time_minutes: d.minutes, pass_score: d.pass, sections: [{ portion: "national", bank, count: full, blueprint: b, pass: passLabel }] });
  }
  return specs;
}

function pctOf(s: string | null): number | null {
  if (!s) return null;
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return Number(pct[1]) / 100;
  const frac = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (frac && Number(frac[2]) > 0) return Number(frac[1]) / Number(frac[2]);
  return null;
}

/** Specs for a state: `short` in the exam's proportions + `form-1..forms` full-length forms. */
export function stateSpecs(st: StateRecord, blueprints: Blueprint[], forms: number): FormSpec[] {
  const se = st.salesperson_exam;
  const natBank = nationalBankFor(st.vendor);
  const sections: Array<Omit<SectionSpec, "count"> & { count: number }> = [];
  if (natBank && se.national_items) sections.push({ portion: "national", bank: natBank, count: se.national_items, blueprint: bp(blueprints, natBank), pass: se.pass_score_national ?? se.pass_score_combined });
  const stateCount = se.state_items ?? (natBank ? null : se.total_items);
  if (stateCount) sections.push({ portion: "state", bank: `state_${st.code}`, count: stateCount, blueprint: bp(blueprints, `state_${st.code}`), pass: se.pass_score_state ?? se.pass_score_combined });
  if (!sections.length) throw new Error(`${st.code}: state record has no item counts; cannot build a form`);
  const total = sections.reduce((a, s) => a + s.count, 0);
  const minutes = se.time_minutes ?? Math.round(total * 1.5);
  const pass = pctOf(se.pass_score_combined) ?? pctOf(se.pass_score_state) ?? pctOf(se.pass_score_national) ?? 0.75;
  const name = JURISDICTIONS[st.code as keyof typeof JURISDICTIONS] ?? st.code;
  const shortCounts = apportion(sections.map((s) => ({ node: s.bank, label: s.bank, exam_items: s.count, target_bank_items: 0 })), SHORT_FORM_ITEMS);
  const specs: FormSpec[] = [
    { form_id: SHORT_FORM_ID, title: `Short mock · ${name}`, time_minutes: SHORT_FORM_MINUTES, pass_score: pass, sections: sections.map((s, i) => ({ ...s, count: shortCounts[i]!.count })).filter((s) => s.count > 0) },
  ];
  for (let n = 1; n <= forms; n++) specs.push({ form_id: `form-${n}`, title: `Form ${n} · ${name} (${total} questions)`, time_minutes: minutes, pass_score: pass, sections });
  return specs;
}

export interface MockFormRowOut {
  id: string; bank: string; jurisdiction: string | null; form_id: string; title: string; item_ids: string[];
  time_limit_s: number; pass_score: number; portions: BuiltPortion[]; status: "active"; published_at: string;
}

export function toRows(target: string, forms: BuiltForm[], now = new Date().toISOString()): MockFormRowOut[] {
  const isState = isJurisdictionCode(target);
  const bank = isState ? `state_${target}` : target;
  const jurisdiction = isState ? target : null;
  return forms.map((f) => ({
    id: `${bank}:${jurisdiction ?? "NAT"}:${f.form_id}`,
    bank, jurisdiction, form_id: f.form_id, title: f.title, item_ids: f.item_ids,
    time_limit_s: f.time_limit_s, pass_score: Number(f.pass_score.toFixed(4)), portions: f.portions, status: "active", published_at: now,
  }));
}

export interface FormsBuildOptions {
  forms?: number;
  remote?: boolean | SupabaseRemote;
  contentDir?: string;
  log?: (line: string) => void;
}
export interface FormsBuildResult { target: string; built: BuiltForm[]; skipped: AssembleResult["skipped"]; notes: string[]; upserted: number; retired: number; warnings: string[] }

/** Build the forms for a target and, with `remote`, upsert them into mock_forms (retiring stale ids). */
export async function formsBuild(target: string, opts: FormsBuildOptions = {}): Promise<FormsBuildResult> {
  const contentDir = opts.contentDir ?? CONFIG.contentDir;
  const log = opts.log ?? (() => {});
  const blueprints = loadBlueprints(contentDir).blueprints.map((b) => b.value);
  const items = loadItems(contentDir).items.map((x) => x.value).filter((i) => PUBLISHABLE.has(i.status));

  let specs: FormSpec[];
  if (target === "national_pearsonvue" || target === "national_psi") {
    specs = nationalSpecs(target, blueprints, items.filter((i) => i.bank === target).length);
  } else if (isJurisdictionCode(target)) {
    const path = join(contentDir, "states", `${target}.yaml`);
    if (!existsSync(path)) throw new Error(`no state record at ${path}`);
    specs = stateSpecs(StateRecord.parse(readYaml(path)), blueprints, opts.forms ?? 5);
  } else {
    throw new Error(`forms-build: target must be national_pearsonvue, national_psi or a state code, got "${target}"`);
  }

  const r = assembleForms(items, specs, seedFor(target));
  for (const f of r.forms) log(`${target}: ${f.form_id} — ${f.item_ids.length} items / ${Math.round(f.time_limit_s / 60)} min (${f.portions.map((p) => `${p.item_ids.length} ${p.portion}`).join(" + ")}) "${f.title}"`);
  for (const s of r.skipped) log(`${target}: ${s.form_id} not built — ${s.reason}`);
  for (const n of r.notes) log(`  note: ${n}`);

  const result: FormsBuildResult = { target, built: r.forms, skipped: r.skipped, notes: r.notes, upserted: 0, retired: 0, warnings: [] };
  if (!opts.remote || r.forms.length === 0) {
    if (!r.forms.length) log(`${target}: nothing to publish`);
    return result;
  }
  const remote = typeof opts.remote === "object" ? opts.remote : remoteFromEnv();
  const rows = toRows(target, r.forms);
  const w = await remote.writeRows("mock_forms", rows, "upsert");
  if (w === "missing") { result.warnings.push("mock_forms table not found (migration 0021 pending) — forms not written"); return result; }
  result.upserted = rows.length;
  // retire rows for this target that were not rebuilt (bank thinned out, forms renamed)
  const bank = rows[0]!.bank;
  const jurFilter = rows[0]!.jurisdiction ? `jurisdiction=eq.${rows[0]!.jurisdiction}` : "jurisdiction=is.null";
  const existing = await remote.readRows<{ id: string }>("mock_forms", `bank=eq.${bank}&${jurFilter}&status=eq.active&select=id`);
  const keep = new Set(rows.map((x) => x.id));
  const stale = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (stale.length) {
    await remote.patchRows("mock_forms", `id=in.(${stale.map((s) => `"${s}"`).join(",")})`, { status: "retired" });
    result.retired = stale.length;
  }
  log(`${target}: ${result.upserted} forms upserted into mock_forms${result.retired ? `, ${result.retired} retired` : ""}`);
  return result;
}
