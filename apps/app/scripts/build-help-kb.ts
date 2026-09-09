/**
 * Builds public/content/help.json — the in-app Help Center knowledge base (V2 plan §1 "Support").
 *
 *   pnpm --filter @rep/app help:kb
 *
 * Sources (all in the repo, so the KB can never drift from the product rules):
 *   docs/HELP_FAQ.md                      hand-written FAQ (## sections with category/keywords lines)
 *   docs/SPEC.md §5.2, §5.3, §6           one-person rule, 3-device rule, pricing / free tier / guarantee
 *   docs/QA_PROCESS.md, QA_REVIEWER_GUIDE.md, CONTENT_PIPELINE.md   how every question is verified
 *   app/pages/methodology.vue             readiness score methodology (tags stripped)
 *   app/pages/legal/*.vue                 disclaimer and other legal text
 *
 * Shape: { generated, articles: [{ id, title, category, body_md, keywords[] }], index: { keyword: [ids] } }
 * Limits: ≤ 60 articles, ≤ 250 words each (long sections are split into numbered parts).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const docs = resolve(root, "docs");
const pages = resolve(here, "../app/pages");
const outDir = resolve(here, "../public/content");
const MAX_ARTICLES = 60, MAX_WORDS = 250;

export interface HelpArticle { id: string; title: string; category: string; body_md: string; keywords: string[]; source: string }
export interface HelpKb { generated: string; articles: HelpArticle[]; index: Record<string, string[]> }

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Markdown section body under a heading matching `re` (up to the next heading of the same or higher level). */
function section(md: string, re: RegExp): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) return "";
  const level = (lines[start]!.match(/^#+/)?.[0].length) ?? 2;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { const m = lines[i]!.match(/^(#+)\s/); if (m && m[1]!.length <= level) { end = i; break; } }
  return lines.slice(start + 1, end).join("\n").trim();
}

/** Keep paragraphs (blank-line separated) that match `keep`, drop any matching `drop`. Tables are kept whole. */
function curate(md: string, opts: { keep?: RegExp; drop?: RegExp } = {}): string {
  return md.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .filter((p) => (!opts.keep || opts.keep.test(p)) && !(opts.drop && opts.drop.test(p)))
    .join("\n\n");
}

/** Remove whole sentences matching `re` (founder-voice asides that do not belong in a help article). */
function dropSentences(md: string, re: RegExp): string {
  return md.split(/\n\s*\n/).map((p) => p.split(/(?<=[.!?]["”*)]*)\s+(?=[A-Z*"“(])/).filter((s) => !re.test(s)).join(" ")).filter((p) => p.trim()).join("\n\n");
}

/** Split a body into ≤ MAX_WORDS chunks on paragraph boundaries (sentence boundaries inside an oversized paragraph). */
function chunk(body: string): string[] {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [], n = 0;
  const flush = () => { if (cur.length) out.push(cur.join("\n\n")); cur = []; n = 0; };
  for (const p of paras) {
    const w = words(p);
    if (w > MAX_WORDS) {
      flush();
      let piece: string[] = [], pn = 0;
      for (const s of p.split(/(?<=[.!?])\s+/)) { const sw = words(s); if (pn + sw > MAX_WORDS && piece.length) { out.push(piece.join(" ")); piece = []; pn = 0; } piece.push(s); pn += sw; }
      if (piece.length) out.push(piece.join(" "));
      continue;
    }
    if (n + w > MAX_WORDS) flush();
    cur.push(p); n += w;
  }
  flush();
  return out;
}

const STOP = new Set("a an and are as at be been but by can do does for from has have how i if in into is it its may more must not of on one only or our so than that the their them then there these they this to under until up use used using was we what when where which who will with within you your".split(" "));
function tokens(s: string): string[] {
  return [...new Set(s.toLowerCase().replace(/[`*_#>|]/g, " ").replace(/[^a-z0-9$%.\- ]+/g, " ").split(/\s+/).map((t) => t.replace(/^[.\-]+|[.\-]+$/g, "")).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)))];
}

const articles: HelpArticle[] = [];
function add(title: string, category: string, body: string, keywords: string[], source: string) {
  const parts = chunk(body);
  if (!parts.length) throw new Error(`"${title}" from ${source} produced no text — the source heading moved or every paragraph was filtered out`);
  parts.forEach((body_md, i) => {
    const t = parts.length > 1 ? `${title} (${i + 1}/${parts.length})` : title;
    const id = `${slug(category)}--${slug(t)}`;
    if (articles.some((a) => a.id === id)) return;
    articles.push({ id, title: t, category, body_md, keywords: [...new Set([...keywords.map((k) => k.toLowerCase().trim()).filter(Boolean), ...topTerms(`${title} ${body_md}`)])], source });
  });
}
function topTerms(text: string, n = 8): string[] {
  const freq = new Map<string, number>();
  for (const t of text.toLowerCase().replace(/[^a-z0-9$%\- ]+/g, " ").split(/\s+/)) { const w = t.replace(/^-+|-+$/g, ""); if (w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)) freq.set(w, (freq.get(w) ?? 0) + 1); }
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([w]) => w);
}

// ---------------------------------------------------------------------------
// 1. Hand-written FAQ: docs/HELP_FAQ.md
// ---------------------------------------------------------------------------
{
  const md = read(resolve(docs, "HELP_FAQ.md"));
  for (const block of md.split(/\n(?=## )/).slice(1)) {
    const lines = block.split("\n");
    const title = lines[0]!.replace(/^##\s*/, "").trim();
    let category = "FAQ"; const kws: string[] = []; const body: string[] = [];
    for (const l of lines.slice(1)) {
      const m = l.match(/^(category|keywords):\s*(.+)$/i);
      if (m && !body.some((b) => b.trim())) { if (m[1]!.toLowerCase() === "category") category = m[2]!.trim(); else kws.push(...m[2]!.split(",")); continue; }
      body.push(l);
    }
    add(title, category, body.join("\n").trim(), kws, "docs/HELP_FAQ.md");
  }
}

// ---------------------------------------------------------------------------
// 2. Product rules from SPEC.md (curated lines only — the spec is written for the founder)
// ---------------------------------------------------------------------------
{
  const spec = read(resolve(docs, "SPEC.md"));
  const pricing = section(spec, /^## 6\. Pricing and Packaging/);
  add("Plans at a glance", "Pricing & plans", curate(pricing, { keep: /^\|\s*(Tier|---|Free|\*\*Complete|Pass guarantee)|^\*\*The offer|^All 50 states|^\*\*Free tier must/ }).replace(/^\*\*Free tier must be genuinely useful\.\*\*\s*/m, "**The free tier is meant to be useful.** "), ["price", "$59", "free", "complete", "guarantee", "one time", "forever", "subscription"], "docs/SPEC.md §6");
  const sharing = section(spec, /^### 5\.2 Design so sharing hurts/);
  const devices = section(spec, /^### 5\.3 Entitlement mechanics/);
  const onePerson = dropSentences(
    curate(sharing, { keep: /^If five people share|^Surface this in the UI/ }).replace(/^Surface this in the UI honestly, not as a threat: /m, "The app says it plainly: ")
    + "\n\n" + curate(devices, { keep: /^\*\*Device registry\.\*\*/ }).replace(/^\*\*Device registry\.\*\* Bind entitlement to an account, allow/m, "**Devices.** Your purchase is bound to your account and works on"),
    /without you doing anything|more effective than a lockout|study group of six/);
  add("One account, one person", "Account & devices", onePerson, ["sharing", "devices", "3 devices", "readiness", "account"], "docs/SPEC.md §5.2–5.3");
}

// ---------------------------------------------------------------------------
// 3. How questions are verified
// ---------------------------------------------------------------------------
{
  const pipeline = read(resolve(docs, "CONTENT_PIPELINE.md"));
  const ingest = section(pipeline, /^## 1\. Ingest ground truth/);
  const verify = section(pipeline, /^## 3\. Verify/);
  add("Where our answers come from", "How questions are verified",
    dropSentences(
      (curate(ingest, { keep: /^The pipeline refuses to draft|^Files land in|^Every ingested document/ }).replace(/```[\s\S]*?```\n?/g, "")
      + "\n\n" + curate(verify, { keep: /^3a is deterministic|^\*\*Kill criterion/ }).replace(/^\*\*Kill criterion \(SPEC §11\):\*\*\s*/m, "**Our own stop rule:** "))
        .replace(/\s*\(SPEC §[\d.]+\)/g, "").replace(/\s+([:.,])/g, "$1")
        .replace(/^3a is deterministic and runs offline\. It also requires/m, "The first, automated check runs offline and requires").replace(/3b then sends the verifier/g, "An independent model verifier then receives").replace(/3b is adversarial/g, "The verifier is adversarial").replace(/items that survived\s+3b/g, "items that survived verification"),
      /\.pipeline\/|prompt tuning|QA sheets/),
    ["citation", "statute", "verified", "source", "quote", "authority"], "docs/CONTENT_PIPELINE.md");
  const qa = read(resolve(docs, "QA_PROCESS.md"));
  // the Rules section is one numbered list; make each rule its own paragraph so ops-only rules can be dropped individually
  const rules = section(qa, /^## Rules/).replace(/\n(?=\d+\. )/g, "\n\n").replace(/^\d+\. \*\*/gm, "**").replace(/^\d+\. /gm, "");
  add("How every question is reviewed", "How questions are verified",
    curate(rules, { drop: /Helpers|helper|Kill criterion|Forson's decision/ }).replace(/\s*\(`pnpm pipeline qa-packet <bank>`\)/g, "").replace(/docs\/QA_REVIEWER_GUIDE\.md/g, "our reviewer guide").replace(/\s*\(docs\/[A-Z_]+\.md\)/g, "").replace(/docs\/[A-Z_]+\.md/g, "our QA log").replace(/`qa-approve` \/ `qa-reject`/g, "the approve / reject commands").replace(/`\.pipeline\/rejected\/<bank>\/`/g, "the rejected-items folder"),
    ["review", "reviewer", "quality", "reject", "approve"], "docs/QA_PROCESS.md");
  const guide = read(resolve(docs, "QA_REVIEWER_GUIDE.md"));
  add("What a reviewer checks on every question", "How questions are verified", curate(section(guide, /^## The check, in order/), { drop: /^Mark `approve`/ }), ["reviewer", "key", "distractor", "stem", "explanation", "math"], "docs/QA_REVIEWER_GUIDE.md");
}

// ---------------------------------------------------------------------------
// 4. Methodology + legal pages (Vue templates → text)
// ---------------------------------------------------------------------------
function vueText(file: string): string {
  const src = read(file).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  return src
    .replace(/<template v-if[^>]*>[\s\S]*?<\/template>/g, "")
    .replace(/<\/(h1|h2|h3|p|li|div)>/g, "\n\n").replace(/<li[^>]*>/g, "- ").replace(/<strong>([\s\S]*?)<\/strong>/g, "**$1**").replace(/<code>([\s\S]*?)<\/code>/g, "`$1`")
    .replace(/<h1[^>]*>/g, "# ").replace(/<h2[^>]*>/g, "## ").replace(/<h3[^>]*>/g, "### ")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/\n- \n/g, "\n").trim();
}
{
  const meth = vueText(resolve(pages, "methodology.vue"));
  const parts = meth.split(/\n(?=## )/);
  const intro = parts[0]!.replace(/^# .*\n?/, "").trim();
  add("How the readiness score is computed", "Readiness score", intro, ["readiness", "score", "methodology", "prediction"], "app/pages/methodology.vue");
  for (const p of parts.slice(1)) {
    const title = p.split("\n")[0]!.replace(/^##\s*\d*\.?\s*/, "").trim();
    add(title, "Readiness score", p.split("\n").slice(1).join("\n").trim(), ["readiness", "score"], "app/pages/methodology.vue");
  }
  const legalDir = resolve(pages, "legal");
  if (existsSync(legalDir)) for (const f of readdirSync(legalDir).filter((f) => f.endsWith(".vue")).sort()) {
    const text = vueText(resolve(legalDir, f));
    const fallback = basename(f, ".vue").replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    const title = text.match(/^# (.+)$/m)?.[1]?.trim() ?? fallback;
    add(title, "Legal", text.replace(/^# .*\n?/, "").trim(), ["legal", basename(f, ".vue")], `app/pages/legal/${f}`);
  }
}

// ---------------------------------------------------------------------------
// Validate, index, write
// ---------------------------------------------------------------------------
const tooLong = articles.filter((a) => words(a.body_md) > MAX_WORDS);
if (tooLong.length) throw new Error(`articles over ${MAX_WORDS} words: ${tooLong.map((a) => a.id).join(", ")}`);
const empty = articles.filter((a) => !a.body_md.trim());
if (empty.length) throw new Error(`empty articles: ${empty.map((a) => a.id).join(", ")}`);
if (articles.length > MAX_ARTICLES) throw new Error(`${articles.length} articles > ${MAX_ARTICLES}; trim docs/HELP_FAQ.md or the curated sources`);

const index: Record<string, string[]> = {};
for (const a of articles) for (const t of [...tokens(`${a.title} ${a.body_md}`), ...a.keywords]) (index[t] ??= []).push(a.id);
for (const k of Object.keys(index)) index[k] = [...new Set(index[k])];

const kb: HelpKb = { generated: new Date().toISOString(), articles: articles.map(({ source, ...a }) => ({ ...a, source })), index: Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b))) };
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "help.json"), JSON.stringify(kb, null, 1) + "\n");
const byCat = articles.reduce<Record<string, number>>((m, a) => ((m[a.category] = (m[a.category] ?? 0) + 1), m), {});
console.log(`help.json: ${articles.length} articles (${Object.entries(byCat).map(([c, n]) => `${c} ${n}`).join(", ")}), ${Object.keys(index).length} index terms, longest ${Math.max(...articles.map((a) => words(a.body_md)))} words`);
