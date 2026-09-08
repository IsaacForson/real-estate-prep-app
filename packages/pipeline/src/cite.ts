/**
 * Citation plumbing — how a blueprint `statute_refs` entry or an item's `citation.source`
 * finds the right cached authority and the right slice of it.
 *
 *   doc citation:  "Tex. Occ. Code ch. 1101"          "15 U.S.C. §§ 1601–1667f (TILA)"     "REP Ref. Contracts"
 *   ref / source:  "Tex. Occ. Code § 1101.652(b)"     "15 U.S.C. § 1635(a)"  or  "TILA"    "REP Ref. Contracts § 2.3"
 */
import type { StatuteDoc } from "./statutes.js";

const STOP = new Set(["ch", "chapter", "chs", "chapters", "et", "seq", "s", "ss", "sec", "section", "sections", "art", "article", "arts", "r", "rule", "rules", "pt", "part", "pts", "parts", "tit", "title", "tits", "titles", "subch", "div", "division", "and", "the", "of", "to", "through", "ann", "regs", "regulations"]);
const TITLE_WORDS = new Set(["tit", "title", "tits", "titles"]);
const CHAPTER_WORDS = new Set(["ch", "chapter", "chs", "chapters", "art", "article", "arts", "pt", "part", "pts", "parts", "subch", "div", "division"]);

export type NumKind = "sec" | "tit" | "ch";
export interface CitationTokens { words: string[]; nums: string[]; kinds: Map<string, NumKind> }

/**
 * Tokenise a citation. Hyphens are part of a section number ("40-57-135", "858-101");
 * only an en/em dash — or the word "to"/"through" between two numbers — marks a RANGE, which is
 * normalised to "~" ("1601–1667f" → "1601~1667f", "858-101 to 858-605" → "858-101~858-605").
 * Each number is tagged by what introduced it: a title word, a chapter/article/part word, or a
 * section sign / nothing ("sec"). Tags persist across a comma list ("chs. 36-1C, 43-15A").
 */
export function tokens(cit: string): CitationTokens {
  const noParen = cit.replace(/\([^)]*\)/g, " ");
  const ranged = noParen.toLowerCase()
    .replace(/((?:[a-z]{1,3}-?)?\d[0-9a-z.\-]*)\s*(?:[–—]|\s(?:to|through)\s)\s*((?:[a-z]{1,3}-?)?\d[0-9a-z.\-]*)/g, "$1~$2");
  const raw = ranged.replace(/§+/g, " § ").replace(/[^a-z0-9.\-~§ ]+/g, " ").split(/\s+/).filter(Boolean);
  const words: string[] = [], nums: string[] = [];
  const kinds = new Map<string, NumKind>();
  let pending: NumKind = "sec";
  for (const t of raw) {
    if (t === "§") { pending = "sec"; continue; }
    const clean = t.replace(/^\.+|\.+$/g, "");
    if (!clean) continue;
    if (/^\d/.test(clean) || /^[a-z]{1,3}-?\d/.test(clean)) { nums.push(clean); kinds.set(clean, pending); continue; }
    if (TITLE_WORDS.has(clean)) pending = "tit";
    else if (CHAPTER_WORDS.has(clean)) pending = "ch";
    else if (!STOP.has(clean)) { words.push(clean); pending = "sec"; }
  }
  return { words, nums, kinds };
}

/** Loose singular/plural equality for citation words ("statement" ≈ "statements"). */
function wordEq(a: string, b: string): boolean {
  if (a === b) return true;
  const strip = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  return strip(a) === strip(b);
}

function parenAlias(cit: string): string[] {
  return [...cit.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!.toLowerCase().trim());
}

/** "1601~1667f" → [1601, 1667]; "10160~10249.93" → [10160, 10249]; "1101" → [1101, 1101]; hyphenated compound numbers are not ranges. */
function numRange(n: string): [number, number] | null {
  const m = n.match(/^(\d+)[a-z]*(?:\.\d+[a-z]*)?(?:~(\d+)[a-z]*(?:\.\d+[a-z]*)?)?$/);
  if (!m) return null;
  const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
  return [a, b];
}
/** Compound range like "858-101~858-605" or "47-2853.01~47-2853.30": does ref "858-135" / "47-2853.12" fall inside? Compares the last numeric segment, then the decimal ordinal when a bound carries one. */
function compoundRangeContains(dn: string, rn: string): boolean {
  const m = dn.match(/^(.*?)(\d+)[a-z]*(?:\.(\d+))?[a-z]*~(.*?)(\d+)[a-z]*(?:\.(\d+))?[a-z]*$/);
  if (!m || m[1] !== m[4]) return false;
  const prefix = m[1]!;
  if (!rn.startsWith(prefix)) return false;
  const tail = rn.slice(prefix.length).match(/^(\d+)(?:\.(\d+))?/);
  if (!tail) return false;
  const v = Number(tail[1]), lo = Number(m[2]), hi = Number(m[5]);
  if (v < lo || v > hi) return false;
  const dec = tail[2] !== undefined ? Number(tail[2]) : -1;
  if (v === lo && m[3] !== undefined && dec < Number(m[3])) return false;
  if (v === hi && m[6] !== undefined && dec > Number(m[6])) return false;
  return true;
}

/**
 * Does a blueprint ref / item source refer to this cached document?
 * A doc citation may join several authorities with ";" and may carry aliases in parentheses;
 * each part and each alias is tried as a citation in its own right.
 */
export function refMatchesDoc(ref: string, docCitation: string): boolean {
  const r = ref.trim().toLowerCase(), d = docCitation.trim().toLowerCase();
  if (!r || !d) return false;
  if (d.includes(r) || r.includes(d)) return true;
  const candidates = [
    ...docCitation.split(";").map((x) => x.trim()).filter(Boolean),
    ...parenAlias(docCitation),
  ];
  return candidates.some((c) => citationMatches(ref, c));
}

function citationMatches(ref: string, cit: string): boolean {
  const r = ref.trim().toLowerCase(), c = cit.trim().toLowerCase();
  if (r === c || r.startsWith(c + " ") || r.startsWith(c + "§") || r.startsWith(c + ",")) return true;
  const etSeq = /\bet\s+seq\b/.test(c);
  const dt = tokens(cit), rt = tokens(ref);
  if (!dt.words.length && !dt.nums.length) return false;
  if (!dt.words.every((w) => rt.words.some((x) => wordEq(w, x)))) return false;
  if (!dt.nums.length) return rt.words.length > 0; // "REP Ref. Contracts"-style docs: word match is enough

  const numMatches = (dn: string): boolean => {
    const range = numRange(dn);
    return rt.nums.some((rn) => {
      if (rn === dn || rn.startsWith(dn + ".") || rn.startsWith(dn + "-")) return true;
      if (dn.includes("~") && compoundRangeContains(dn, rn)) return true;
      // chapter number used as a section prefix: doc "ch. 29" ↔ ref "§ 2903"
      if (!/[.\-~]/.test(dn) && dn.length >= 2 && rn.startsWith(dn) && /^\d/.test(rn.slice(dn.length))) return true;
      // "X-Y-1 et seq." style root: same prefix up to the last segment, last segment ≥ start
      if (etSeq && etSeqContains(dn, rn)) return true;
      const rr = numRange(rn.split(".")[0]!);
      return !!(range && rr && rr[0] >= range[0] && rr[0] <= range[1] && range[0] !== range[1]);
    });
  };

  // Section-level numbers (after § or bare) are the real root and must ALL match; when present,
  // title/chapter containers are informational ("ch. 392, §§ 20-311 to 20-329").
  const secNums = dt.nums.filter((n) => dt.kinds.get(n) === "sec");
  if (secNums.length) return secNums.every(numMatches);
  // Otherwise the doc is identified by containers: every KIND must match, and within a kind a
  // comma list is alternatives ("chs. 36-1C, 43-15A, 43-4" → any one).
  const byKind = new Map<NumKind, string[]>();
  for (const n of dt.nums) { const k = dt.kinds.get(n)!; if (!byKind.has(k)) byKind.set(k, []); byKind.get(k)!.push(n); }
  return [...byKind.values()].every((group) => group.some(numMatches));
}

/** "08.88.011" (et seq.) contains "08.88.037"; "54.1-2100" contains "54.1-2105" and "54.1-2106.1"; "64.010" contains "64.170". */
function etSeqContains(dn: string, rn: string): boolean {
  const sep = /[.\-]/;
  const dParts = dn.split(sep), rParts = rn.split(sep);
  if (dParts.length < 2 || rParts.length < dParts.length) return false;
  for (let i = 0; i < dParts.length - 1; i++) if (dParts[i] !== rParts[i]) return false;
  const last = dParts.length - 1;
  const dv = parseInt(dParts[last]!, 10), rv = parseInt(rParts[last]!, 10);
  if (Number.isNaN(dv) || Number.isNaN(rv)) return false;
  return rv >= dv;
}

/**
 * The section key a ref names *inside* the doc, if more specific than the doc root.
 * "Tex. Occ. Code § 1101.652(b)" vs doc ch. 1101 → "1101.652";  "15 U.S.C. § 1635(a)" → "1635";
 * "REP Ref. Contracts § 2.3" → "2.3";  "TILA" → null.
 */
export function sectionKey(ref: string, docCitation: string): string | null {
  const dt = tokens(docCitation);
  // A key names the whole document only if it equals a non-range doc number (a range start is a real section).
  const isRoot = (k: string) => dt.nums.some((n) => !n.includes("~") && n === k.toLowerCase());
  const rt = tokens(ref);
  const m = ref.match(/§+\s*([0-9][0-9a-z.\-]*)/i) ?? ref.match(/\b(?:sec\.|section|rule|r\.)\s*([0-9][0-9a-z.\-]*)/i);
  if (m) {
    const key = m[1]!.replace(/[.\-]+$/, "");
    if (!isRoot(key)) return key;
    // "§ 725-1, ch. 2": the § names the doc; a later container number is the real key
    const after = rt.nums.filter((n) => !n.includes("~") && !isRoot(n) && n !== key.toLowerCase());
    return after.length ? recase(ref, after.at(-1)!) : null;
  }
  // No section sign ("20 CSR 2250-2.010", "18 VAC 135-20-160", "CP-2"): the most specific number in the ref
  // is the key, unless it merely names the document root.
  const last = rt.nums.filter((n) => !n.includes("~")).at(-1);
  if (!last || isRoot(last)) return null;
  return recase(ref, last);
}

/** Recover original casing/punctuation of a lower-cased token from the ref text. */
function recase(ref: string, tok: string): string {
  const re = new RegExp(esc(tok).replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`));
  return (ref.match(re)?.[0] ?? tok).replace(/[.\-]+$/, "");
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Slice the text of one section out of a document. Heading heuristics cover govinfo
 * ("§1635. Right of rescission"), Texas/Florida-style ("Sec. 1101.652.", "475.25 Discipline."),
 * rule codes ("Rule 535.2", "R 339.22301", "61J2-14.009") and our reference notes ("### § 2.3 Title").
 * Falls back to a ±window around the first mention; null if the key never appears.
 */
export function sliceSection(text: string, key: string, window = 3000): string | null {
  const direct = sliceExact(text, key, window);
  if (direct) return direct;
  // Parent fallback: "09.11.01.19" → "09.11.01" (the chapter), "17-323" stays (single parent would be too broad).
  const parts = key.split(/[.\-]/);
  if (parts.length >= 3) return sliceExact(text, parts.slice(0, -1).join(key.includes(".") ? "." : "-"), window);
  return null;
}

function sliceExact(text: string, key: string, window: number): string | null {
  // Statute text often prints section numbers with en dashes ("17–323"); match any dash.
  const k = esc(key).replace(/-/g, "[-–—]");
  const PREFIX = "(?:§+\\s*|Sec\\.\\s*|Section\\s*|Rule\\s*|R\\s*)";
  // A heading may carry a short code prefix before the number: "20 CSR 2250-2.010", "18VAC135-20-160", "R4-28-101".
  const CODE = "(?:[A-Za-z0-9§.]{1,8}\\s?){0,3}?";
  const heading = new RegExp(`^[ \\t]*(?:#{1,4}\\s*)?(${PREFIX})?${CODE}${k}(?![0-9a-zA-Z])[.\\s:–—-]`, "gim");
  const shape = key.split(/(\d+|[a-zA-Z]+)/).filter(Boolean).map((part) => /^\d+$/.test(part) ? "\\d+" : /^[a-zA-Z]+$/.test(part) ? "[a-zA-Z]*" : esc(part).replace(/-/g, "[-–—]")).join("");
  let best: string | null = null;
  for (const m of text.matchAll(heading)) {
    const start = m.index!;
    const rest = text.slice(start + m[0].length);
    // The section ends at the next heading of the SAME SHAPE ("1101.652" → \d+\.\d+, "40-57-135" → \d+-\d+-\d+,
    // "1635" → \d+); if the start heading carried a § / Sec. prefix, the next one must too.
    const hadPrefix = !!m[1];
    const next = new RegExp(`\\n[ \\t]*(?:#{1,4}\\s*)?${hadPrefix ? PREFIX : `${PREFIX}?`}${CODE}${shape}(?![0-9a-zA-Z])[.\\s:–—-]\\s*[A-Z"“(]`).exec(rest);
    const end = next ? start + m[0].length + next.index : Math.min(text.length, start + window * 4);
    const slice = text.slice(start, end).trim();
    // Several headings can match (a table of contents lists the same number): keep the longest body.
    if (!best || slice.length > best.length) best = slice;
  }
  if (best) return best;
  const i = text.search(new RegExp(`(?<![0-9.])${k}(?![0-9])`));
  if (i < 0) return null;
  return text.slice(Math.max(0, i - window), Math.min(text.length, i + window)).trim();
}

export interface QuoteHit { doc: StatuteDoc; index: number }

const norm = (s: string) => s.toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").replace(/[^a-z0-9§ ]/g, "");

/** Find which cached doc contains the quoted text (same normalisation as quoteAppears). */
export function locateQuote(docs: StatuteDoc[], quote: string): QuoteHit | null {
  const q = norm(quote);
  if (q.length < 15) return null;
  for (const doc of docs) {
    const n = norm(doc.text);
    const j = n.indexOf(q);
    if (j >= 0) {
      // map back approximately: proportional position (normalisation is near length-preserving)
      const index = Math.min(doc.text.length - 1, Math.round((j / Math.max(1, n.length)) * doc.text.length));
      return { doc, index };
    }
  }
  return null;
}

/** Text the verifier sees: the enclosing section (by nearest heading) or a ±window around the quote. */
export function excerptAround(text: string, index: number, window = 6000): string {
  const before = text.slice(Math.max(0, index - window), index);
  const after = text.slice(index, Math.min(text.length, index + window));
  const headRe = /\n[ \t]*(?:#{1,4}\s*)?(?:§+\s*|Sec\.\s*|Section\s*|Rule\s*)?\d+[0-9a-zA-Z]*(?:\.\d+[a-zA-Z]*)*(?![0-9])[.\s:–—-]/g;
  let lastHead = 0;
  for (const m of before.matchAll(headRe)) lastHead = m.index!;
  const nextHead = after.search(/\n[ \t]*(?:#{1,4}\s*)?(?:§+\s*|Sec\.\s*|Section\s*|Rule\s*)?\d+[0-9a-zA-Z]*(?:\.\d+[a-zA-Z]*)*(?![0-9])[.\s:–—-]\s*[A-Z"“(]/);
  const start = lastHead, end = nextHead > 200 ? nextHead : after.length;
  return (before.slice(start) + after.slice(0, end)).trim();
}

/**
 * Resolve a node's statute_refs against cached docs → the text to draft from.
 * Section-specific refs are sliced; doc-level refs include the whole doc.
 */
export function resolveRefs(refs: string[], docs: StatuteDoc[]): { text: string; slugs: string[]; unmatched: string[]; unsliced: string[] } {
  const parts: string[] = [], slugs = new Set<string>(), unmatched: string[] = [], unsliced: string[] = [];
  const wholeDocs = new Set<string>();
  const seen = new Set<string>();
  for (const ref of refs) {
    const hits = docs.filter((d) => refMatchesDoc(ref, d.citation));
    if (!hits.length) { unmatched.push(ref); continue; }
    const sliced = hits.map((d) => { const key = sectionKey(ref, d.citation); return { d, key, sl: key ? sliceSection(d.text, key) : null }; });
    const anySliced = sliced.some((x) => x.sl);
    for (const { d, key, sl } of sliced) {
      if (!key) { slugs.add(d.slug); if (!wholeDocs.has(d.slug)) { wholeDocs.add(d.slug); parts.push(`### ${d.citation} — ${d.title}\n\n${d.text}`); } continue; }
      const dedupe = `${d.slug}#${key}`;
      if (seen.has(dedupe)) continue;
      if (sl) { seen.add(dedupe); slugs.add(d.slug); parts.push(`### ${d.citation} — ${d.title} — § ${key}\n\n${sl}`); }
      else if (!anySliced) { seen.add(dedupe); slugs.add(d.slug); unsliced.push(ref); if (!wholeDocs.has(d.slug)) { wholeDocs.add(d.slug); parts.push(`### ${d.citation} — ${d.title}\n\n${d.text}`); } }
    }
  }
  return { text: parts.join("\n\n"), slugs: [...slugs], unmatched: [...new Set(unmatched)], unsliced: [...new Set(unsliced)] };
}
