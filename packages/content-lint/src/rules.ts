import { type Item, keyIndex, domainOf, OPTION_LETTERS } from "@rep/schema";
import type { Finding } from "./types.js";
import { endsWithPeriod, startsUpper, startsWithArticleOrVerbForm, normalize, shingles, jaccard } from "./text.js";

/*
 * Distractor lint rules — SPEC §3.6. Every rule is a pure function.
 *   per-item rules:   (item) => Finding[]
 *   aggregate rules:  (items) => Finding[]   — grouped by bank + top-level domain
 * ERROR blocks merge. WARN is reported but does not fail CI.
 */

export const THRESHOLDS = {
  /** Correct answer may be the strictly-longest option in at most this share of a domain's items. */
  longestIsKeyMaxShare: 0.25,
  /** Options must be within ±30% of the mean option length (chars). */
  optionLengthTolerance: 0.3,
  /** Key position share bounds per domain once the domain has >= minForDistribution items. */
  keyPositionMinShare: 0.15,
  keyPositionMaxShare: 0.35,
  minForDistribution: 20,
  /** 3-gram shingle Jaccard at or above this is a near-duplicate. */
  nearDupJaccard: 0.6,
} as const;

const ABSOLUTES = ["always", "never", "must never", "cannot ever", "under no circumstances", "in all cases", "without exception"];
const ALL_NONE_RE = /\b(all|none|both|neither)\s+of\s+the\s+above\b|\b(a|b|c|d)\s+and\s+(a|b|c|d)\s+(only|above)\b/i;
const NEGATION_RE = /\b(not|except|never|least|false|incorrect|cannot)\b/i;
const BOLD_NEGATION_RE = /\*\*\s*(not|except|never|least|false|incorrect|cannot)\s*\*\*/i;

const f = (rule: string, severity: Finding["severity"], subject: string, message: string): Finding => ({ rule, severity, subject, message });

// ---------- per-item rules ----------

export function ruleNoAllNoneOfTheAbove(item: Item): Finding[] {
  return item.options.flatMap((o, i) =>
    ALL_NONE_RE.test(o) ? [f("no-all-none-of-the-above", "error", item.id, `option ${OPTION_LETTERS[i]} is an all/none/both-of-the-above construction`)] : [],
  );
}

export function ruleOptionLengths(item: Item): Finding[] {
  const lens = item.options.map((o) => o.trim().length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const out: Finding[] = [];
  lens.forEach((l, i) => {
    const dev = Math.abs(l - mean) / mean;
    if (Math.abs(l - mean) < 12) return; // a few characters' difference on short options is not a tell
    if (dev > THRESHOLDS.optionLengthTolerance)
      out.push(f("option-length-balance", "error", item.id, `option ${OPTION_LETTERS[i]} length ${l} deviates ${(dev * 100).toFixed(0)}% from mean ${mean.toFixed(0)} (limit ${THRESHOLDS.optionLengthTolerance * 100}%)`));
  });
  return out;
}

export function ruleOptionGrammaticalForm(item: Item): Finding[] {
  const out: Finding[] = [];
  const periods = new Set(item.options.map(endsWithPeriod));
  if (periods.size > 1) out.push(f("option-form-punctuation", "warn", item.id, "options are inconsistent in terminal punctuation"));
  const caps = new Set(item.options.map(startsUpper));
  if (caps.size > 1) out.push(f("option-form-capitalisation", "warn", item.id, "options are inconsistent in initial capitalisation"));
  const forms = item.options.map(startsWithArticleOrVerbForm);
  const nonOther = forms.filter((x) => x !== "other");
  if (nonOther.length && new Set(nonOther).size > 1)
    out.push(f("option-form-opening", "warn", item.id, `options open with mixed forms: ${forms.join(", ")}`));
  return out;
}

export function ruleAbsoluteQualifiers(item: Item): Finding[] {
  const has = item.options.map((o) => ABSOLUTES.filter((a) => new RegExp(`\\b${a}\\b`, "i").test(o)));
  const anyHas = has.some((h) => h.length);
  if (!anyHas) return [];
  const allHave = has.every((h) => h.length);
  if (allHave) return [];
  const offenders = has.map((h, i) => (h.length ? `${OPTION_LETTERS[i]}(${h.join("/")})` : null)).filter(Boolean);
  return [f("absolute-qualifier", "error", item.id, `absolute qualifier in some but not all options: ${offenders.join(", ")}`)];
}

export function ruleNegativeStemBolded(item: Item): Finding[] {
  if (!NEGATION_RE.test(item.stem)) return [];
  if (BOLD_NEGATION_RE.test(item.stem)) return [];
  return [f("negative-stem-not-bolded", "error", item.id, "negatively-worded stem must bold the negation, e.g. **NOT** / **EXCEPT**")];
}

export function ruleCitationAndExplanation(item: Item): Finding[] {
  const out: Finding[] = [];
  if (!item.explanation?.trim()) out.push(f("explanation-required", "error", item.id, "explanation is empty"));
  if (!item.citation?.source?.trim()) out.push(f("citation-required", "error", item.id, "citation.source is empty"));
  if (!item.citation?.quoted_text?.trim()) out.push(f("citation-quote-required", "error", item.id, "citation.quoted_text is empty"));
  if (item.citation?.source && !/§|sec\.|section|art\.|ch\.|chapter|c\.|r\.s\.|code|stat\.|u\.s\.c\.|c\.f\.r\.|ilcs|o\.c\.g\.a\.|n\.j\.s\.a\.|rcw|wac|vac|p\.s\.|pa\. code|admin|rule/i.test(item.citation.source))
    out.push(f("citation-form", "warn", item.id, `citation.source "${item.citation.source}" does not look like a legal citation`));
  return out;
}

export function ruleKeyNotEchoedInStem(item: Item): Finding[] {
  // A stem that contains the key's distinctive words nearly verbatim is a giveaway.
  const key = item.options[keyIndex(item.key)]!;
  const sim = jaccard(shingles(item.stem, 2), shingles(key, 2));
  return sim >= 0.5 ? [f("key-echoed-in-stem", "warn", item.id, `keyed option shares ${(sim * 100).toFixed(0)}% of 2-grams with the stem`)] : [];
}

export function ruleMathHasWork(item: Item): Finding[] {
  const looksMath = /\$\s?\d|\d+(\.\d+)?\s?%|\bper (month|year|annum)\b|\bprorat|\bcommission of\b|\bsquare (feet|foot)\b|\bacre/i.test(item.stem);
  if (looksMath && !item.math) return [f("math-worked-solution", "error", item.id, "stem looks numeric but item has no math.worked_solution (SPEC F15)")];
  return [];
}

const META_STEM_RE = /\b(according to|per|under|in) the (reference|supplied text|passage|text above|statute above|excerpt)\b/i;

const META_ANY_RE = /\b(the (reference|supplied text|passage|text above|statute above|excerpt|governing text)|the text (lists|states|says|provides|defines|notes|explains|describes|directs|requires|instructs|warns|tells|specifies|indicates)|as (stated|noted|explained) (in|by) the (reference|text|passage))\b/i;

export function ruleNoMetaReference(item: Item): Finding[] {
  const out: Finding[] = [];
  if ([item.stem, ...item.options].some((t) => META_STEM_RE.test(t))) out.push(f("meta-reference-in-stem", "error", item.id, "stem/option refers to 'the reference/supplied text' — the candidate never sees it"));
  if (META_ANY_RE.test(item.explanation)) out.push(f("meta-reference-in-explanation", "error", item.id, "explanation refers to 'the reference/text' — state the rule directly and cite the section"));
  return out;
}

/** "$22,825" and "$22,825.00" are the same answer; so are "6%" and "6.0%". */
export function ruleNumericallyDistinctOptions(item: Item): Finding[] {
  const nums = item.options.map((o) => {
    const m = o.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g);
    if (!m || m.length !== 1) return null;
    const rest = o.replace(/[\d.,\s$%-]/g, "").toLowerCase();
    return `${Number(m[0])}|${rest}`;
  });
  const seen = new Map<string, number>();
  const out: Finding[] = [];
  nums.forEach((n, i) => {
    if (n == null) return;
    if (seen.has(n)) out.push(f("options-numerically-equal", "error", item.id, `options ${OPTION_LETTERS[seen.get(n)!]} and ${OPTION_LETTERS[i]} are numerically the same value`));
    else seen.set(n, i);
  });
  return out;
}

/** Explanations must describe wrong answers by content: option letters are reassigned when key positions are balanced. */
export function ruleNoOptionLettersInExplanation(item: Item): Finding[] {
  // "(C)" between other parentheses or after a digit is a statutory subsection ("§ 3607(b)(2)(C)(i)"), not an option letter.
  return /\b(?:[Oo]ption|[Cc]hoice|[Aa]nswer|[Aa]lternative)s?\s+\(?[A-D]\)?(?![A-Za-z])|(?<![\w)])(?<!(?:sub)?paragraph |subsection |subdivision |clause |section |item |§ ?)\(\s*[A-D]\s*\)(?![(\w])|\b[A-D]\s+is\s+(?:correct|incorrect|wrong|right|the answer)\b/.test(item.explanation)
    ? [f("explanation-option-letter", "error", item.id, "explanation refers to an option by letter; letters change when positions are balanced — describe the option's content instead")]
    : [];
}

export const ITEM_RULES = [
  ruleNoMetaReference,
  ruleNoOptionLettersInExplanation,
  ruleNumericallyDistinctOptions,
  ruleNoAllNoneOfTheAbove,
  ruleOptionLengths,
  ruleOptionGrammaticalForm,
  ruleAbsoluteQualifiers,
  ruleNegativeStemBolded,
  ruleCitationAndExplanation,
  ruleKeyNotEchoedInStem,
  ruleMathHasWork,
];

export function lintItem(item: Item): Finding[] {
  return ITEM_RULES.flatMap((r) => r(item));
}

// ---------- aggregate rules ----------

export function groupKey(item: Item): string {
  return `${item.bank}/${domainOf(item.blueprint_node)}`;
}

function groupBy(items: Item[]): Map<string, Item[]> {
  const m = new Map<string, Item[]>();
  for (const it of items) {
    const k = groupKey(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return m;
}

export function ruleLongestIsKeyShare(items: Item[]): Finding[] {
  const out: Finding[] = [];
  for (const [g, list] of groupBy(items)) {
    if (list.length < 8) continue;
    let longestIsKey = 0;
    for (const it of list) {
      const lens = it.options.map((o) => o.trim().length);
      const max = Math.max(...lens);
      const kLen = lens[keyIndex(it.key)]!;
      if (kLen === max && lens.filter((l) => l === max).length === 1) longestIsKey++;
    }
    const share = longestIsKey / list.length;
    if (share > THRESHOLDS.longestIsKeyMaxShare)
      out.push(f("longest-option-is-key", "error", g, `key is the longest option in ${(share * 100).toFixed(0)}% of ${list.length} items (limit ${THRESHOLDS.longestIsKeyMaxShare * 100}%)`));
  }
  return out;
}

export function ruleKeyPositionDistribution(items: Item[]): Finding[] {
  const out: Finding[] = [];
  for (const [g, list] of groupBy(items)) {
    if (list.length < THRESHOLDS.minForDistribution) continue;
    const counts = [0, 0, 0, 0];
    for (const it of list) counts[keyIndex(it.key)]!++;
    counts.forEach((c, i) => {
      const share = c / list.length;
      if (share < THRESHOLDS.keyPositionMinShare || share > THRESHOLDS.keyPositionMaxShare)
        out.push(f("key-position-distribution", "error", g, `key is ${OPTION_LETTERS[i]} in ${(share * 100).toFixed(0)}% of ${list.length} items (want ${THRESHOLDS.keyPositionMinShare * 100}–${THRESHOLDS.keyPositionMaxShare * 100}%)`));
    });
  }
  return out;
}

export function ruleUniqueIds(items: Item[]): Finding[] {
  const seen = new Map<string, number>();
  for (const it of items) seen.set(it.id, (seen.get(it.id) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([id, n]) => f("unique-id", "error", id, `id appears ${n} times`));
}

/** Near-duplicate stems within a bank. O(n²) per bank; fine to ~5k items per bank. */
export function ruleNearDuplicateStems(items: Item[]): Finding[] {
  const out: Finding[] = [];
  const byBank = new Map<string, Item[]>();
  for (const it of items) {
    if (!byBank.has(it.bank)) byBank.set(it.bank, []);
    byBank.get(it.bank)!.push(it);
  }
  for (const list of byBank.values()) {
    const sh = list.map((it) => shingles(it.stem, 3));
    const norm = list.map((it) => normalize(it.stem));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (norm[i] === norm[j]) {
          out.push(f("duplicate-stem", "error", list[i]!.id, `identical stem to ${list[j]!.id}`));
          continue;
        }
        const s = jaccard(sh[i]!, sh[j]!);
        if (s >= THRESHOLDS.nearDupJaccard)
          out.push(f("near-duplicate-stem", "error", list[i]!.id, `stem is ${(s * 100).toFixed(0)}% similar to ${list[j]!.id}`));
      }
    }
  }
  return out;
}

export const AGGREGATE_RULES = [ruleUniqueIds, ruleLongestIsKeyShare, ruleKeyPositionDistribution, ruleNearDuplicateStems];

export function lintItems(items: Item[]): Finding[] {
  return [...items.flatMap(lintItem), ...AGGREGATE_RULES.flatMap((r) => r(items))];
}
