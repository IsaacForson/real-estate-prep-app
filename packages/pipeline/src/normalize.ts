/**
 * Deterministic clean-ups applied to every draft before the gates. None changes meaning:
 *   - bold bare NOT / EXCEPT / LEAST in stems (lint requires it; models forget the asterisks);
 *   - complete a citation.source that names only a section ("§ 13.2 Vacancy…") with the document the
 *     quote was actually found in ("REP Ref. Real Estate Math § 13.2");
 *   - shuffle options with a per-item seed so the key position is uniform across a bank (models key "A").
 */
import { OPTION_LETTERS, type Item, type OptionLetter } from "@rep/schema";
import type { StatuteDoc } from "./statutes.js";
import { locateQuote, refMatchesDoc, sectionKey } from "./cite.js";

export function boldNegations(stem: string): string {
  if (/\*\*\s*(not|except|least|never|false|incorrect|cannot)\s*\*\*/i.test(stem)) return stem;
  return stem.replace(/\b(NOT|EXCEPT|LEAST|NEVER|FALSE|INCORRECT|CANNOT)\b/g, "**$1**").replace(/\b(not|except|least)\b(?=[^.]*\?)/, (m) => `**${m.toUpperCase()}**`);
}

export function normalizeSource(source: string, quote: string, docs: StatuteDoc[]): string {
  const hit = locateQuote(docs, quote);
  if (!hit) return source;
  if (refMatchesDoc(source, hit.doc.citation)) return source;
  // bare heading like "§ 13.2 Vacancy, occupancy and management fees" or "13.2" → prefix the doc citation
  const m = source.match(/§+\s*([0-9][0-9a-z.\-]*)/i) ?? source.match(/^\s*([0-9][0-9a-z.\-]*)\b/);
  if (m) {
    const candidate = `${hit.doc.citation} § ${m[1]}`;
    if (sectionKey(candidate, hit.doc.citation) !== null || refMatchesDoc(candidate, hit.doc.citation)) return candidate;
  }
  return source;
}

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return () => ((h = (h * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Shuffle options (and key) deterministically per item id. Skips options that are an ordered numeric ladder? No — exams do not sort options. */
export function shuffleOptions(item: Item): Item {
  const rnd = seeded(item.id);
  const idx = [0, 1, 2, 3];
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j]!, idx[i]!]; }
  const keyIdx = OPTION_LETTERS.indexOf(item.key);
  const options = idx.map((i) => item.options[i]!);
  const key = OPTION_LETTERS[idx.indexOf(keyIdx)] as OptionLetter;
  return { ...item, options, key };
}

export function normalizeDraft(item: Item, docs: StatuteDoc[]): Item {
  const stem = boldNegations(item.stem);
  const source = normalizeSource(item.citation.source, item.citation.quoted_text, docs);
  return shuffleOptions({ ...item, stem, citation: { ...item.citation, source } });
}

/** Reorder options so that `key` lands at `target`, preserving the relative order of the others. */
export function placeKey(item: Item, target: OptionLetter): Item {
  const k = OPTION_LETTERS.indexOf(item.key), t = OPTION_LETTERS.indexOf(target);
  if (k === t) return item;
  const others = item.options.filter((_, i) => i !== k);
  const options = [...others.slice(0, t), item.options[k]!, ...others.slice(t)];
  return { ...item, options, key: target };
}

/** Assign key positions round-robin (A,B,C,D…) over items sorted by id within each bank/domain — exactly uniform. */
export function assignKeyPositions(items: Item[]): Item[] {
  const groups = new Map<string, Item[]>();
  for (const it of items) { const g = `${it.bank}/${it.blueprint_node.split(".")[0]}`; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(it); }
  const out: Item[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
    // start offset from a hash of the group so different domains don't all begin with A
    const start = [...list[0]!.bank].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 4;
    list.forEach((it, i) => out.push(placeKey(it, OPTION_LETTERS[(start + i) % 4]!)));
  }
  return out;
}
