/**
 * `pipeline refs-audit [XX|national_psi|...]` — for every blueprint node, resolve statute_refs
 * against the cached authorities and report: refs matched, sliced to a section, whole-doc,
 * unmatched, and the per-node text size vs the drafting cap. This is the pre-flight for `draft`.
 */
import { loadBlueprints } from "@rep/content-lint";
import { CONFIG } from "./config.js";
import { loadStatutes } from "./statutes.js";
import { refMatchesDoc, sectionKey, sliceSection, resolveRefs } from "./cite.js";

export interface NodeAudit { bank: string; node: string; refs: number; matched: number; sliced: number; whole: number; unmatched: string[]; chars: number }

export function auditRefs(filter?: string): NodeAudit[] {
  const { blueprints } = loadBlueprints(CONFIG.contentDir);
  const out: NodeAudit[] = [];
  const cap = Number(process.env.DRAFT_MAX_STATUTE_CHARS ?? 400_000);
  for (const { value: bp } of blueprints) {
    if (filter && bp.id !== filter && bp.id !== `state_${filter}`) continue;
    const jur = bp.id.startsWith("state_") ? bp.id.slice(6) : "NAT";
    const docs = loadStatutes(jur);
    for (const exam of [bp.exams.salesperson]) {
      for (const d of exam.domains) for (const s of d.subtopics) {
        let matched = 0, sliced = 0, whole = 0;
        const unmatched: string[] = [];
        for (const r of s.statute_refs) {
          const hits = docs.filter((doc) => refMatchesDoc(r, doc.citation));
          if (!hits.length) { unmatched.push(r); continue; }
          matched++;
          const h = hits[0]!;
          const key = sectionKey(r, h.citation);
          if (key && sliceSection(h.text, key)) sliced++; else whole++;
        }
        const chars = docs.length && s.statute_refs.length ? resolveRefs(s.statute_refs, docs).text.length : 0;
        out.push({ bank: bp.id, node: s.id, refs: s.statute_refs.length, matched, sliced, whole, unmatched, chars });
        void cap;
      }
    }
  }
  return out;
}

export function renderAudit(rows: NodeAudit[]): string {
  const cap = Number(process.env.DRAFT_MAX_STATUTE_CHARS ?? 400_000);
  const byBank = new Map<string, NodeAudit[]>();
  for (const r of rows) { if (!byBank.has(r.bank)) byBank.set(r.bank, []); byBank.get(r.bank)!.push(r); }
  const lines = ["bank                  nodes  refs  matched  sliced  whole  unmatched  over-cap  no-refs"];
  for (const [bank, list] of byBank) {
    const t = list.reduce((a, r) => ({ refs: a.refs + r.refs, m: a.m + r.matched, s: a.s + r.sliced, w: a.w + r.whole, u: a.u + r.unmatched.length, over: a.over + (r.chars > cap ? 1 : 0), none: a.none + (r.refs === 0 ? 1 : 0) }), { refs: 0, m: 0, s: 0, w: 0, u: 0, over: 0, none: 0 });
    lines.push(`${bank.padEnd(21)} ${String(list.length).padEnd(6)} ${String(t.refs).padEnd(5)} ${String(t.m).padEnd(8)} ${String(t.s).padEnd(7)} ${String(t.w).padEnd(6)} ${String(t.u).padEnd(10)} ${String(t.over).padEnd(9)} ${t.none}`);
  }
  return lines.join("\n");
}
