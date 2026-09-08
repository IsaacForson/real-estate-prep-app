import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import YAML from "yaml";
import { Item, StateRecord, Blueprint, JURISDICTION_CODES, LAUNCH_CRITICAL_FIELDS } from "@rep/schema";
import type { Finding } from "./types.js";

export function walk(dir: string, exts = [".yaml", ".yml"]): string[] {
  let out: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) out = out.concat(walk(p, exts));
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out.sort();
}

export interface Loaded<T> { file: string; value: T }

export function loadItems(root: string): { items: Loaded<Item>[]; findings: Finding[] } {
  const items: Loaded<Item>[] = [];
  const findings: Finding[] = [];
  for (const file of walk(join(root, "items"))) {
    const rel = relative(root, file);
    let raw: unknown;
    try { raw = YAML.parse(readFileSync(file, "utf8")); } catch (e) {
      findings.push({ rule: "yaml-parse", severity: "error", subject: rel, file: rel, message: String(e) });
      continue;
    }
    const docs = Array.isArray(raw) ? raw : [raw];
    for (const d of docs) {
      const r = Item.safeParse(d);
      if (!r.success) {
        for (const iss of r.error.issues)
          findings.push({ rule: "schema", severity: "error", subject: (d as any)?.id ?? rel, file: rel, message: `${iss.path.join(".")}: ${iss.message}` });
      } else items.push({ file: rel, value: r.data });
    }
  }
  return { items, findings };
}

export function loadStates(root: string): { states: Loaded<StateRecord>[]; findings: Finding[] } {
  const states: Loaded<StateRecord>[] = [];
  const findings: Finding[] = [];
  const dir = join(root, "states");
  const files = walk(dir);
  const seen = new Set<string>();
  for (const file of files) {
    const rel = relative(root, file);
    let raw: unknown;
    try { raw = YAML.parse(readFileSync(file, "utf8")); } catch (e) {
      findings.push({ rule: "yaml-parse", severity: "error", subject: rel, file: rel, message: String(e) });
      continue;
    }
    const r = StateRecord.safeParse(raw);
    if (!r.success) {
      for (const iss of r.error.issues)
        findings.push({ rule: "schema", severity: "error", subject: (raw as any)?.code ?? rel, file: rel, message: `${iss.path.join(".")}: ${iss.message}` });
      continue;
    }
    seen.add(r.data.code);
    states.push({ file: rel, value: r.data });
    // launch-critical completeness (warn: a state can exist in "in production" status without these)
    for (const path of LAUNCH_CRITICAL_FIELDS) {
      const v = path.split(".").reduce<any>((o, k) => (o == null ? o : o[k]), r.data);
      if (v == null) findings.push({ rule: "state-launch-field", severity: "warn", subject: r.data.code, file: rel, message: `launch-critical field ${path} is null` });
    }
    const se = r.data.salesperson_exam;
    if (se.national_items != null && se.state_items != null && se.total_items != null && se.national_items + se.state_items !== se.total_items)
      findings.push({ rule: "state-item-arith", severity: "error", subject: r.data.code, file: rel, message: `national ${se.national_items} + state ${se.state_items} != total ${se.total_items}` });
  }
  for (const c of JURISDICTION_CODES)
    if (!seen.has(c)) findings.push({ rule: "state-missing", severity: "warn", subject: c, message: `no content/states/${c}.yaml yet` });
  return { states, findings };
}

export function loadBlueprints(root: string): { blueprints: Loaded<Blueprint>[]; findings: Finding[] } {
  const blueprints: Loaded<Blueprint>[] = [];
  const findings: Finding[] = [];
  for (const file of walk(join(root, "blueprints"))) {
    const rel = relative(root, file);
    let raw: unknown;
    try { raw = YAML.parse(readFileSync(file, "utf8")); } catch (e) {
      findings.push({ rule: "yaml-parse", severity: "error", subject: rel, file: rel, message: String(e) });
      continue;
    }
    const r = Blueprint.safeParse(raw);
    if (!r.success) {
      for (const iss of r.error.issues)
        findings.push({ rule: "schema", severity: "error", subject: (raw as any)?.id ?? rel, file: rel, message: `${iss.path.join(".")}: ${iss.message}` });
      continue;
    }
    blueprints.push({ file: rel, value: r.data });
    for (const [examName, exam] of Object.entries(r.data.exams)) {
      if (!exam) continue;
      const sum = exam.domains.reduce((a, d) => a + d.items, 0);
      if (sum !== exam.scored_items)
        findings.push({ rule: "blueprint-arith", severity: "error", subject: r.data.id, file: rel, message: `${examName}: domain items sum to ${sum}, scored_items is ${exam.scored_items}` });
    }
  }
  return { blueprints, findings };
}

/**
 * State blueprints must agree with the state map: vendor matches, and salesperson scored_items
 * equals the record's state_items (or total_items for unsplit exams). Subtopics without
 * statute_refs cannot be drafted, so they warn.
 */
export function crossCheckStateBlueprints(blueprints: Loaded<Blueprint>[], states: Loaded<StateRecord>[]): Finding[] {
  const out: Finding[] = [];
  const byCode = new Map<string, StateRecord>(states.map((s) => [s.value.code, s.value]));
  for (const { value: bp, file } of blueprints) {
    if (!bp.id.startsWith("state_")) continue;
    const code = bp.id.slice(6);
    const st = byCode.get(code);
    if (!st) { out.push({ rule: "state-blueprint-orphan", severity: "error", subject: bp.id, file, message: `no content/states/${code}.yaml for this blueprint` }); continue; }
    if (bp.vendor !== st.vendor) out.push({ rule: "state-blueprint-vendor", severity: "error", subject: bp.id, file, message: `blueprint vendor ${bp.vendor} != state record vendor ${st.vendor}` });
    const se = st.salesperson_exam;
    const expected = se.state_items ?? se.total_items;
    if (expected != null && bp.exams.salesperson.scored_items !== expected)
      out.push({ rule: "state-blueprint-items", severity: "error", subject: bp.id, file, message: `salesperson scored_items ${bp.exams.salesperson.scored_items} != state record ${se.state_items != null ? "state_items" : "total_items"} ${expected}` });
    for (const exam of Object.values(bp.exams)) {
      if (!exam) continue;
      for (const d of exam.domains) for (const s of d.subtopics)
        if (!s.statute_refs.length) out.push({ rule: "blueprint-node-no-refs", severity: "warn", subject: bp.id, file, message: `${s.id} has no statute_refs — cannot be drafted` });
    }
  }
  return out;
}

/** Every item.blueprint_node must exist in its bank's blueprint (domain or subtopic id). */
export function crossCheckItemsToBlueprints(items: Loaded<Item>[], blueprints: Loaded<Blueprint>[]): Finding[] {
  const nodes = new Map<string, Set<string>>();
  for (const { value: bp } of blueprints) {
    const s = new Set<string>();
    for (const exam of Object.values(bp.exams)) {
      if (!exam) continue;
      for (const d of exam.domains) { s.add(d.id); for (const st of d.subtopics) s.add(st.id); }
    }
    nodes.set(bp.id, s);
  }
  const out: Finding[] = [];
  for (const { value: it, file } of items) {
    const s = nodes.get(it.bank);
    if (!s) { out.push({ rule: "blueprint-missing", severity: "error", subject: it.id, file, message: `no blueprint for bank ${it.bank}` }); continue; }
    if (!s.has(it.blueprint_node)) out.push({ rule: "blueprint-node", severity: "error", subject: it.id, file, message: `blueprint_node ${it.blueprint_node} not in ${it.bank} blueprint` });
  }
  return out;
}
