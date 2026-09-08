/**
 * `pipeline status [--md docs/STATUS.md]` — one row per jurisdiction + the two national banks.
 * This is the source of truth for the in-app honesty labels (SPEC §10: "Florida — 620 verified
 * questions. Wyoming — in production. You already own it.").
 */
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { JURISDICTION_CODES, JURISDICTIONS, nationalBankFor, nodeTargets, type Item } from "@rep/schema";
import { loadItems, loadStates, loadBlueprints } from "@rep/content-lint";
import { CONFIG } from "./config.js";
import { loadStatutes } from "./statutes.js";
import { refMatchesDoc } from "./cite.js";
import { writeText } from "./fsx.js";

export interface BankStatus {
  bank: string;
  label: string;
  vendor: string | null;
  map: "high" | "medium" | "low" | "missing" | "n/a";
  blueprint: boolean;
  target: number;
  authorities: number;
  authority_chars: number;
  /** blueprint statute_refs that resolve to a cached authority: [matched, total] */
  refs: [number, number];
  items: Record<Item["status"], number>;
  mocks: number;
  phase: "not started" | "mapped" | "blueprinted" | "grounded" | "drafting" | "verified" | "mocks ready" | "complete";
}

const STATUSES: Item["status"][] = ["draft", "verified", "qa_approved", "published", "retired"];

export function computeStatus(): BankStatus[] {
  const { states } = loadStates(CONFIG.contentDir);
  const { blueprints } = loadBlueprints(CONFIG.contentDir);
  const { items } = loadItems(CONFIG.contentDir);
  const byBank = new Map<string, Item[]>();
  for (const { value } of items) { if (!byBank.has(value.bank)) byBank.set(value.bank, []); byBank.get(value.bank)!.push(value); }
  const bp = (id: string) => blueprints.find((b) => b.value.id === id)?.value;
  const drafts = (bank: string) => { const d = join(CONFIG.stateDir, "drafts", bank); return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".yaml")).length : 0; };

  const row = (bank: string, label: string, jur: string, vendor: string | null, map: BankStatus["map"]): BankStatus => {
    const b = bp(bank);
    const docs = loadStatutes(jur);
    const mine = byBank.get(bank) ?? [];
    const counts = Object.fromEntries(STATUSES.map((s) => [s, mine.filter((i) => i.status === s).length])) as BankStatus["items"];
    counts.draft += drafts(bank);
    const target = b ? nodeTargets(b).reduce((a, t) => a + t.target_bank_items, 0) : 0;
    let refTotal = 0, refMatched = 0;
    if (b) for (const dom of b.exams.salesperson.domains) for (const sub of dom.subtopics) for (const r of sub.statute_refs) { refTotal++; if (docs.some((doc) => refMatchesDoc(r, doc.citation))) refMatched++; }
    const mocksDir = join(CONFIG.contentDir, "mocks", jur);
    const mocks = existsSync(mocksDir) ? readdirSync(mocksDir).filter((f) => f.endsWith(".yaml")).length : 0;
    const live = counts.verified + counts.qa_approved + counts.published;
    let phase: BankStatus["phase"] = "not started";
    if (map !== "missing") phase = "mapped";
    if (b) phase = "blueprinted";
    if (b && docs.length && refTotal && refMatched / refTotal >= 0.5) phase = "grounded";
    if (counts.draft > 0 && live === 0) phase = "drafting";
    if (live > 0) phase = "verified";
    if (mocks >= 5) phase = "mocks ready";
    if (mocks >= 5 && target > 0 && counts.published >= target) phase = "complete";
    return { bank, label, vendor, map, blueprint: !!b, target, authorities: docs.length, authority_chars: docs.reduce((a, d) => a + d.text.length, 0), refs: [refMatched, refTotal], items: counts, mocks, phase };
  };

  const out: BankStatus[] = [
    row("national_pearsonvue", "National — Pearson VUE", "NAT", "pearsonvue", "n/a"),
    row("national_psi", "National — PSI", "NAT", "psi", "n/a"),
  ];
  for (const code of JURISDICTION_CODES) {
    const st = states.find((s) => s.value.code === code)?.value;
    out.push(row(`state_${code}`, JURISDICTIONS[code], code, st?.vendor ?? null, st ? st.confidence : "missing"));
  }
  return out;
}

export function renderStatus(rows: BankStatus[]): string {
  const h = ["bank", "vendor→national", "map", "bp", "target", "auth (docs/KB)", "refs resolved", "draft", "verified", "qa", "published", "mocks", "phase"];
  const lines = [h.join(" | "), h.map(() => "---").join(" | ")];
  for (const r of rows) {
    const nat = r.bank.startsWith("state_") && r.vendor ? (nationalBankFor(r.vendor as any) ?? "state-own") : "";
    lines.push([
      `${r.label} (${r.bank})`, r.vendor ? `${r.vendor}${nat ? " → " + nat.replace("national_", "") : ""}` : "?", r.map, r.blueprint ? "✓" : "—",
      r.target || "—", r.authorities ? `${r.authorities} / ${Math.round(r.authority_chars / 1000)}` : "—",
      r.refs[1] ? `${r.refs[0]}/${r.refs[1]} (${Math.round((100 * r.refs[0]) / r.refs[1])}%)` : "—",
      r.items.draft, r.items.verified, r.items.qa_approved, r.items.published, r.mocks, r.phase,
    ].join(" | "));
  }
  const tally = rows.slice(2).reduce<Record<string, number>>((a, r) => ((a[r.phase] = (a[r.phase] ?? 0) + 1), a), {});
  return `# Content status\n\nGenerated ${new Date().toISOString().slice(0, 10)} by \`pnpm pipeline status --md docs/STATUS.md\`.\n\nStates by phase: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(" · ")}\n\n${lines.join("\n")}\n`;
}

export function writeStatusMarkdown(path: string) {
  const md = renderStatus(computeStatus());
  writeText(path, md);
  return md;
}
