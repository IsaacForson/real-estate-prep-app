#!/usr/bin/env tsx
/**
 * content-lint <content-dir> [--json] [--warn-as-error] [--states-report]
 * Exit 1 if any ERROR finding. This is the CI gate: a failing item cannot merge.
 */
import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { lintItems } from "./rules.js";
import { loadItems, loadStates, loadBlueprints, crossCheckItemsToBlueprints, crossCheckStateBlueprints } from "./load.js";
import type { Finding } from "./types.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const flags = new Set(args.filter((a) => a.startsWith("--")));
function repoRoot(from = process.cwd()): string {
  let d = resolve(from);
  for (let i = 0; i < 8; i++) { if (existsSync(join(d, "pnpm-workspace.yaml"))) return d; const up = dirname(d); if (up === d) break; d = up; }
  return resolve(from);
}
const root = resolve(repoRoot(), args.find((a) => !a.startsWith("--")) ?? "content");

const { items, findings: fi } = loadItems(root);
const { states, findings: fs } = loadStates(root);
const { blueprints, findings: fb } = loadBlueprints(root);

const findings: Finding[] = [
  ...fi, ...fs, ...fb,
  ...crossCheckItemsToBlueprints(items, blueprints),
  ...crossCheckStateBlueprints(blueprints, states),
  ...lintItems(items.map((x) => x.value)),
];

const fileOf = new Map(items.map((x) => [x.value.id, x.file] as const));
for (const f of findings) if (!f.file && fileOf.has(f.subject)) f.file = fileOf.get(f.subject);

const errors = findings.filter((f) => f.severity === "error");
const warns = findings.filter((f) => f.severity === "warn");

if (flags.has("--states-report")) {
  console.log("code  vendor      split(nat/state/total)  time  grading   pass(nat|state|comb)        conf  unverified");
  for (const { value: s } of states.sort((a, b) => a.value.code.localeCompare(b.value.code))) {
    const e = s.salesperson_exam;
    console.log(
      `${s.code.padEnd(5)} ${s.vendor.padEnd(11)} ${String(`${e.national_items ?? "?"}/${e.state_items ?? "?"}/${e.total_items ?? "?"}`).padEnd(23)} ${String(e.time_minutes ?? "?").padEnd(5)} ${String(e.grading ?? "?").padEnd(9)} ${String(`${e.pass_score_national ?? "-"}|${e.pass_score_state ?? "-"}|${e.pass_score_combined ?? "-"}`).padEnd(27)} ${s.confidence.padEnd(5)} ${s.unverified.length}`,
    );
  }
  console.log(`\n${states.length}/51 jurisdictions mapped.`);
}

if (flags.has("--json")) {
  console.log(JSON.stringify({ counts: { items: items.length, states: states.length, blueprints: blueprints.length, errors: errors.length, warns: warns.length }, findings }, null, 2));
} else {
  for (const f of [...errors, ...warns]) {
    const loc = f.file ? ` (${f.file})` : "";
    console.log(`${f.severity === "error" ? "ERROR" : "WARN "} [${f.rule}] ${f.subject}${loc}: ${f.message}`);
  }
  console.log(`\ncontent-lint: ${items.length} items, ${states.length} states, ${blueprints.length} blueprints — ${errors.length} errors, ${warns.length} warnings`);
}

const fail = errors.length > 0 || (flags.has("--warn-as-error") && warns.length > 0);
process.exit(fail ? 1 : 0);
