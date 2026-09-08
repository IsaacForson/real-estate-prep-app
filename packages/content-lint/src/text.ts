/** Small text helpers shared by rules. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/[^a-z0-9$%.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

export function shingles(s: string, n = 3): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  if (w.length < n) {
    if (w.length) out.add(w.join(" "));
    return out;
  }
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function endsWithPeriod(s: string): boolean {
  return /[.!?]\s*$/.test(s.trim());
}
export function startsUpper(s: string): boolean {
  const c = s.trim()[0];
  return !!c && c === c.toUpperCase() && c !== c.toLowerCase();
}
export function startsWithArticleOrVerbForm(s: string): "article" | "gerund" | "infinitive" | "other" {
  const w = words(s)[0] ?? "";
  if (["a", "an", "the"].includes(w)) return "article";
  if (/ing$/.test(w)) return "gerund";
  if (w === "to") return "infinitive";
  return "other";
}
