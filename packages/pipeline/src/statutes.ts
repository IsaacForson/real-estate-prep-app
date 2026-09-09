/**
 * Statute cache — the ground truth every item cites (SPEC §3.4, §3.5 step 1).
 *
 * Layout: content/statutes/<JUR>/<slug>.md with a YAML front-matter header:
 *   citation, url, fetched_on, jurisdiction, title
 * followed by plain text. Statutes are government edicts and not copyrightable, so the
 * text itself is committed to the repo; the raw HTML is git-ignored.
 */
import { join } from "node:path";
import { CONFIG } from "./config.js";
import { writeText, listFiles, existsSync } from "./fsx.js";
import { readFileSync } from "node:fs";

export interface StatuteDoc {
  jurisdiction: string;   // "FL" | "NAT"
  citation: string;       // "Fla. Stat. § 475.25"
  title: string;
  url: string | null;
  fetched_on: string;
  text: string;
  slug: string;
  /** sha256 of the whitespace-normalised text as last fetched from `url` (watch-sources baseline). */
  source_sha256?: string | null;
  /** sha256 of the whitespace-normalised cached `text` (integrity of what items were verified against). */
  text_sha256?: string | null;
  /** Last day watch-sources compared the live source to `source_sha256`. */
  checked_on?: string | null;
  /** Day the live source was last seen to differ; the fetched text is in `_versions/<slug>/<day>.md`. */
  source_changed_on?: string | null;
}

/** Optional front-matter keys written only when set (kept in this order). */
const OPTIONAL_META = ["source_sha256", "text_sha256", "checked_on", "source_changed_on"] as const;

export function slugify(citation: string): string {
  return citation.toLowerCase().replace(/§/g, "s").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function statuteDir(jur: string) {
  return join(CONFIG.contentDir, "statutes", jur);
}

export function saveStatute(doc: Omit<StatuteDoc, "slug">): string {
  const path = join(statuteDir(doc.jurisdiction), `${slugify(doc.citation)}.md`);
  writeText(path, renderStatute(doc));
  return path;
}

/** Front-matter + text exactly as saveStatute writes it (used to rewrite a doc in place at a known path). */
export function renderStatute(doc: Omit<StatuteDoc, "slug">): string {
  const fm = [
    "---",
    `jurisdiction: ${JSON.stringify(doc.jurisdiction)}`,
    `citation: ${JSON.stringify(doc.citation)}`,
    `title: ${JSON.stringify(doc.title)}`,
    `url: ${doc.url ? JSON.stringify(doc.url) : "null"}`,
    `fetched_on: ${JSON.stringify(doc.fetched_on)}`,
    ...OPTIONAL_META.filter((k) => doc[k]).map((k) => `${k}: ${JSON.stringify(doc[k])}`),
    "---",
    "",
  ].join("\n");
  return fm + doc.text.trim() + "\n";
}

export function loadStatutes(jur: string): StatuteDoc[] {
  return listFiles(statuteDir(jur), ".md").map((p) => parseStatuteFile(p));
}

export function parseStatuteFile(path: string): StatuteDoc {
  const raw = readFileSync(path, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`bad statute file ${path}`);
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) {
      const v = line.slice(i + 1).trim();
      try { meta[line.slice(0, i).trim()] = JSON.parse(v); } catch { meta[line.slice(0, i).trim()] = v; }
    }
  }
  return {
    jurisdiction: meta.jurisdiction!, citation: meta.citation!, title: meta.title!,
    url: (meta.url as unknown as string | null) ?? null, fetched_on: String(meta.fetched_on),
    text: m[2]!, slug: path.split("/").pop()!.replace(/\.md$/, ""),
    ...Object.fromEntries(OPTIONAL_META.filter((k) => meta[k]).map((k) => [k, String(meta[k])])),
  };
}

/** Path of a cached doc; `version` selects a later fetch stored by watch-sources. */
export function statutePath(jur: string, slug: string, version?: string): string {
  return version ? join(statuteDir(jur), "_versions", slug, `${version}.md`) : join(statuteDir(jur), `${slug}.md`);
}

/** Very small HTML → text. Legislature sites are mostly server-rendered; PDFs need manual ingest. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&sect;/g, "§").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * govinfo U.S. Code HTML carries, after every section, "Editorial Notes" (amendment history) and
 * "Statutory Notes and Related Subsidiaries" blocks that are 3–5× the size of the statute itself
 * and are never what an exam item cites. Strip them, keep section text, decode entities.
 */
export function cleanUscText(text: string): string {
  const decoded = text
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&sect;/g, "§").replace(/&apos;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&lsquo;|&rsquo;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  const lines = decoded.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^§\s?\d+[a-z0-9\-]*\./.test(line) || /^(SUBCHAPTER|CHAPTER|Part [A-Z]\b|PART [A-Z]\b)/.test(line)) skipping = false;
    else if (/^(Editorial Notes|Statutory Notes and Related Subsidiaries|Executive Documents)\s*$/.test(line)) skipping = true;
    if (!skipping) out.push(raw);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const FETCH_HEADERS = { "user-agent": "Mozilla/5.0 (compatible; rep-pipeline/0.1; statute ingest)", accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8" } as const;

export class SourceFetchError extends Error {
  constructor(message: string, readonly kind: "http" | "unsupported" | "js_shell" | "network") { super(message); }
}

/**
 * The one fetch strategy for authority text (ingest and watch-sources share it): HTML → text,
 * PDF → text, govinfo U.S. Code → notes stripped. Throws SourceFetchError with a kind so callers
 * can tell a blocked/JS-rendered page from a real outage.
 */
export async function fetchSourceText(url: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(opts.timeoutMs ?? Number(process.env.INGEST_TIMEOUT_MS ?? 45_000)), redirect: "follow" });
  } catch (e) {
    // undici hides the interesting part (ECONNREFUSED, CERT_HAS_EXPIRED, ENOTFOUND…) in `cause`
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const why = [e instanceof Error ? e.message : String(e), cause?.code ?? cause?.message].filter(Boolean).join(" — ");
    throw new SourceFetchError(`fetch ${url} failed: ${why}`, "network");
  }
  if (!res.ok) throw new SourceFetchError(`fetch ${url} → ${res.status}`, "http");
  const ct = res.headers.get("content-type") ?? "";
  if (/zip|octet-stream/.test(ct) || /\.zip($|\?)/i.test(url)) throw new SourceFetchError(`${url} is an archive (${ct || "zip"}); text was extracted manually — cannot compare automatically`, "unsupported");
  const isPdf = ct.includes("pdf") || (/\.pdf($|\?)/i.test(url) && !ct.includes("html"));
  const text = isPdf ? await pdfToText(new Uint8Array(await res.arrayBuffer())) : htmlToText(await res.text());
  const cleaned = /govinfo\.gov\/content\/pkg\/USCODE/.test(url) ? cleanUscText(text) : text;
  const minChars = Number(process.env.INGEST_MIN_CHARS ?? 1200);
  if (text.length < minChars || /skip to main content/i.test(text.slice(0, 400)) && text.length < 20_000)
    throw new SourceFetchError(`only ${text.length} chars of text from ${url}; page is likely JS-rendered or a navigation shell. Find a static/PDF version and use 'ingest --file'`, "js_shell");
  return cleaned;
}

export async function fetchStatute(jur: string, citation: string, url: string, title = citation): Promise<string> {
  const text = await fetchSourceText(url);
  return saveStatute({ jurisdiction: jur, citation, title, url, fetched_on: today(), text });
}

/** PDF → text via unpdf (pdf.js). Page breaks become blank lines. */
export async function pdfToText(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join("\n\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Normalised substring check used by verify step 3a: does the quoted text exist in the statute? */
export function quoteAppears(quote: string, statuteText: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").replace(/[^a-z0-9§ ]/g, "").trim();
  const q = n(quote);
  if (q.length < 15) return false;
  return n(statuteText).includes(q);
}

export function hasStatutesFor(jur: string): boolean {
  return existsSync(statuteDir(jur)) && listFiles(statuteDir(jur), ".md").length > 0;
}
