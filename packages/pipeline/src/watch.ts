/**
 * `pipeline watch-sources [--bank <id>] [--dry-run] [--skip-blocked]` — content freshness (V2 §1).
 *
 * For every cached authority with a source URL: re-fetch with the ingest fetch strategy, hash the
 * whitespace-normalised text and compare to `source_sha256` in the doc's front-matter.
 *   • no stored hash      → record a baseline (first run), nothing else
 *   • same hash           → `checked_on` bumped
 *   • different hash      → the fetched text is stored as a new version next to the cached one
 *                           (content/statutes/<JUR>/_versions/<slug>/<date>.md — the cached text
 *                           itself is NOT replaced: it may be a curated slice or OCR, and it is what
 *                           the live items were verified against); every item citing the doc is
 *                           re-checked (quote still verbatim? cited section text unchanged?) and
 *                           failures are marked `status: needs_review` + `review_reason`; a dated
 *                           section goes to docs/STATUTE_CHANGES.md.
 *   • fetch fails / JS shell / archive → skipped with a note (known-blocked hosts never alert).
 * Output: .pipeline/watch/<date>.json (full report) and .pipeline/watch/alerts.json (rows for
 * content_alerts, uploaded by `publish --remote`).
 */
import { join } from "node:path";
import { existsSync, appendFileSync, readdirSync, statSync } from "node:fs";
import { loadItems } from "@rep/content-lint";
import type { Item } from "@rep/schema";
import { CONFIG, repoRoot } from "./config.js";
import { listFiles, readYaml, writeYaml, writeJson, writeText, readJson } from "./fsx.js";
import { fetchSourceText, parseStatuteFile, renderStatute, quoteAppears, today, SourceFetchError, type StatuteDoc } from "./statutes.js";
import { normalizeForHash, textHash } from "./hash.js";
import { refMatchesDoc, sectionKey, sliceSection } from "./cite.js";

/** Hosts that refuse scripted fetches or serve a JS shell (docs/STATUTE_GAPS.md, memory notes). A failure here is expected: noted, never alerted. */
export const KNOWN_BLOCKED_HOSTS = [
  "statutes.capitol.texas.gov", "leg.state.fl.us", "www.leg.state.fl.us", "flsenate.gov", "www.flsenate.gov", "www2.myfloridalicense.com",
  "legislature.mi.gov", "www.legislature.mi.gov", "ars.apps.lara.state.mi.us", "michigan.gov", "www.michigan.gov",
  "outside.vermont.gov", "code.wvlegislature.gov", "docs.legis.wisconsin.gov", "azre.gov", "www.azre.gov", "apps.azsos.gov",
  "malegislature.gov", "www.mass.gov", "leg.state.nv.us", "www.leg.state.nv.us", "gc.nh.gov", "www.gencourt.state.nh.us",
  "njleg.state.nj.us", "pub.njleg.state.nj.us", "lis.njleg.state.nj.us", "codes.ohio.gov", "legislature.ohio.gov", "com.ohio.gov",
  "publications.tnsosfiles.com", "le.utah.gov", "adminrules.utah.gov", "realestate.utah.gov", "ilga.gov", "www.ilga.gov",
  "legislature.idaho.gov", "apps.legislature.ky.gov", "ncleg.gov", "www.ncleg.gov", "palegis.us", "www.legis.state.pa.us",
  "rilegislature.gov", "webserver.rilegislature.gov", "dbr.ri.gov", "oregonlegislature.gov", "www.oregonlegislature.gov",
  "rules.sos.ga.gov", "grec.state.ga.us", "capitol.hawaii.gov", "data.capitol.hawaii.gov", "krec.ks.gov", "doa.la.gov", "www.doa.la.gov",
  "iga.in.gov", "iac.iga.in.gov", "drive.google.com", "trec.texas.gov", "www.trec.texas.gov",
];

export type SourceStatus = "unchanged" | "changed" | "baseline" | "skipped" | "failed";

export interface AffectedItem { id: string; bank: string; file: string; status: Item["status"]; reasons: string[] }
export interface SectionDiff { changed: string[]; removed: string[]; added: string[] }
export interface SourceResult {
  url: string;
  jurisdiction: string;
  citations: string[];
  slugs: string[];
  status: SourceStatus;
  note?: string;
  old_hash?: string | null;
  new_hash?: string | null;
  sections?: SectionDiff;
  affected_items?: AffectedItem[];
  version?: string | null;
}
export interface Alert { kind: "source_changed" | "quote_broken" | "fetch_failed"; jurisdiction: string; ref: string; detail: Record<string, unknown> }
export interface WatchReport {
  date: string;
  dry_run: boolean;
  bank: string | null;
  summary: Record<SourceStatus, number> & { docs: number; sources: number; no_url: number; affected_items: number };
  sources: SourceResult[];
  alerts: Alert[];
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}
export function isKnownBlocked(url: string): boolean {
  const h = hostOf(url);
  return KNOWN_BLOCKED_HOSTS.some((b) => h === b || h.endsWith("." + b));
}

// A section heading at line start: "§1635.", "Sec. 1101.652.", "475.25 Discipline.", "### § 2.3 Title", "R 339.22301", "61J2-14.009 ...".
const HEADING = /^[ \t]*(?:#{1,4}\s*)?(?:§+\s*|Sec\.\s*|Section\s*|Rule\s*|R\s*)?(\d+[0-9a-zA-Z]*(?:[.\-–—]\d+[a-zA-Z]*)*)(?![0-9a-zA-Z])[.\s:–—-]/gm;

/** Split a document into heading → normalised body. Duplicated headings (a table of contents) keep the longest body. */
export function splitSections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const marks: { key: string; start: number }[] = [];
  for (const m of text.matchAll(HEADING)) marks.push({ key: m[1]!.replace(/[–—]/g, "-"), start: m.index! });
  const put = (key: string, body: string) => { const n = normalizeForHash(body); if (!out.has(key) || out.get(key)!.length < n.length) out.set(key, n); };
  if (!marks.length) { put("_document", text); return out; }
  if (marks[0]!.start > 0) put("_preamble", text.slice(0, marks[0]!.start));
  for (let i = 0; i < marks.length; i++) put(marks[i]!.key, text.slice(marks[i]!.start, marks[i + 1]?.start ?? text.length));
  return out;
}

/**
 * Sections whose text differs between the cached and the freshly fetched document. When the
 * cached text is a curated slice of a larger publication, `added` is large and uninformative; the
 * report caps it and callers lead with `changed` / `removed`.
 */
export function diffSections(oldText: string, newText: string, cap = 60): SectionDiff {
  const a = splitSections(oldText), b = splitSections(newText);
  const changed: string[] = [], removed: string[] = [], added: string[] = [];
  for (const [k, v] of a) { if (!b.has(k)) removed.push(k); else if (b.get(k) !== v) changed.push(k); }
  for (const k of b.keys()) if (!a.has(k)) added.push(k);
  return { changed: changed.slice(0, cap), removed: removed.slice(0, cap), added: added.slice(0, cap) };
}

/** Does this item rest on this document? Either its citation names the doc or its quote is found in the doc's text. */
export function itemCitesDoc(item: Item, doc: StatuteDoc): boolean {
  return refMatchesDoc(item.citation.source, doc.citation) || quoteAppears(item.citation.quoted_text, doc.text);
}

/**
 * Items whose evidence no longer holds in the newly fetched text: the quote is not verbatim any
 * more, or the cited section (sliced the way the drafter/verifier saw it) reads differently.
 */
export function affectedItems(doc: StatuteDoc, newText: string, items: { file: string; value: Item }[]): AffectedItem[] {
  const out: AffectedItem[] = [];
  for (const { file, value: item } of items) {
    if (item.status === "retired" || item.status === "draft") continue;
    if (!itemCitesDoc(item, doc)) continue;
    const reasons: string[] = [];
    if (!quoteAppears(item.citation.quoted_text, newText)) reasons.push(`quoted_text no longer appears verbatim in ${doc.citation} as fetched`);
    const key = sectionKey(item.citation.source, doc.citation);
    if (key) {
      const before = sliceSection(doc.text, key), after = sliceSection(newText, key);
      if (before && !after) reasons.push(`section ${key} not found in the fetched text (renumbered or repealed?)`);
      else if (before && after && normalizeForHash(before) !== normalizeForHash(after)) reasons.push(`text of section ${key} changed`);
    }
    if (reasons.length) out.push({ id: item.id, bank: item.bank, file, status: item.status, reasons });
  }
  return out;
}

export function jurisdictionOfBank(bank: string): string { return bank.startsWith("state_") ? bank.slice(6) : "NAT"; }

export interface WatchOptions {
  bank?: string;
  dryRun?: boolean;
  /** Do not even attempt hosts in KNOWN_BLOCKED_HOSTS (faster; default is to try and note the failure). */
  skipBlocked?: boolean;
  concurrency?: number;
  timeoutMs?: number;
  contentDir?: string;
  stateDir?: string;
  docsDir?: string;
  fetcher?: (url: string) => Promise<string>;
  today?: string;
  log?: (line: string) => void;
}

export async function watchSources(opts: WatchOptions = {}): Promise<WatchReport> {
  const contentDir = opts.contentDir ?? CONFIG.contentDir;
  const stateDir = opts.stateDir ?? CONFIG.stateDir;
  const docsDir = opts.docsDir ?? join(repoRoot(), "docs");
  const date = opts.today ?? today();
  const dryRun = !!opts.dryRun;
  const log = opts.log ?? (() => {});
  const fetcher = opts.fetcher ?? ((url: string) => fetchSourceText(url, { timeoutMs: opts.timeoutMs ?? Number(process.env.WATCH_TIMEOUT_MS ?? 30_000) }));
  const jurFilter = opts.bank ? jurisdictionOfBank(opts.bank) : null;

  // 1. every cached doc (optionally one jurisdiction), grouped by source URL
  const statutesRoot = join(contentDir, "statutes");
  const jurs = existsSync(statutesRoot) ? listDirs(statutesRoot).filter((j) => !jurFilter || j === jurFilter) : [];
  const docs: StatuteDoc[] = [];
  const pathOf = new Map<StatuteDoc, string>();
  for (const j of jurs) for (const p of listFiles(join(statutesRoot, j), ".md")) { const d = parseStatuteFile(p); docs.push(d); pathOf.set(d, p); }
  /** Rewrite a cached doc in place with updated metadata (text untouched). */
  const rewrite = (d: StatuteDoc, meta: Partial<StatuteDoc>) => writeText(pathOf.get(d)!, renderStatute({ ...d, text_sha256: d.text_sha256 ?? textHash(d.text), ...meta }));
  const byUrl = new Map<string, StatuteDoc[]>();
  let noUrl = 0;
  for (const d of docs) { if (!d.url) { noUrl++; continue; } if (!byUrl.has(d.url)) byUrl.set(d.url, []); byUrl.get(d.url)!.push(d); }

  // items of the jurisdictions in play, loaded once
  const allItems = loadItems(contentDir).items.filter((x) => !opts.bank || x.value.bank === opts.bank);
  const itemsByJur = new Map<string, { file: string; value: Item }[]>();
  for (const x of allItems) { const j = x.value.jurisdiction; if (!itemsByJur.has(j)) itemsByJur.set(j, []); itemsByJur.get(j)!.push(x); }

  const results: SourceResult[] = [];
  const alerts: Alert[] = [];
  const urls = [...byUrl.keys()].sort();
  let cursor = 0;
  const worker = async () => {
    while (cursor < urls.length) {
      const url = urls[cursor++]!;
      const group = byUrl.get(url)!;
      const r = await checkSource(url, group);
      results.push(r);
      log(`${r.status.padEnd(9)} ${r.jurisdiction.padEnd(3)} ${group.map((d) => d.citation).join("; ").slice(0, 70).padEnd(70)} ${r.note ?? ""}`);
    }
  };

  async function checkSource(url: string, group: StatuteDoc[]): Promise<SourceResult> {
    const jur = group[0]!.jurisdiction;
    const base: SourceResult = { url, jurisdiction: jur, citations: group.map((d) => d.citation), slugs: group.map((d) => d.slug), status: "skipped" };
    const stored = group.map((d) => d.source_sha256 ?? null);
    const oldHash = stored.find((h) => h) ?? null;
    if (opts.skipBlocked && isKnownBlocked(url)) return { ...base, note: "known blocked host — not attempted (--skip-blocked)", old_hash: oldHash };
    let text: string;
    try { text = await fetcher(url); } catch (e) {
      const kind = e instanceof SourceFetchError ? e.kind : "network";
      const msg = e instanceof Error ? e.message : String(e);
      if (isKnownBlocked(url) || kind === "unsupported" || kind === "js_shell") return { ...base, status: "skipped", note: `${kind}: ${msg.slice(0, 200)}`, old_hash: oldHash };
      alerts.push({ kind: "fetch_failed", jurisdiction: jur, ref: group.map((d) => d.citation).join("; "), detail: { url, error: msg.slice(0, 300), kind } });
      return { ...base, status: "failed", note: `${kind}: ${msg.slice(0, 200)}`, old_hash: oldHash };
    }
    const newHash = textHash(text);
    const needBaseline = group.filter((d) => !d.source_sha256);
    if (!oldHash) {
      if (!dryRun) for (const d of group) rewrite(d, { source_sha256: newHash, checked_on: date });
      return { ...base, status: "baseline", new_hash: newHash, note: dryRun ? "no stored hash; would record baseline" : "baseline recorded" };
    }
    if (newHash === oldHash) {
      if (!dryRun) for (const d of group) if (needBaseline.includes(d) || d.checked_on !== date) rewrite(d, { source_sha256: newHash, checked_on: date });
      return { ...base, status: "unchanged", old_hash: oldHash, new_hash: newHash };
    }
    // changed
    const affected: AffectedItem[] = [];
    const sectionsPerDoc: SectionDiff[] = [];
    for (const d of group) {
      sectionsPerDoc.push(diffSections(d.text, text));
      for (const a of affectedItems(d, text, itemsByJur.get(jur) ?? [])) if (!affected.some((x) => x.id === a.id)) affected.push(a);
    }
    const sections: SectionDiff = { changed: uniq(sectionsPerDoc.flatMap((s) => s.changed)), removed: uniq(sectionsPerDoc.flatMap((s) => s.removed)), added: uniq(sectionsPerDoc.flatMap((s) => s.added)).slice(0, 60) };
    if (!dryRun) {
      for (const d of group) {
        writeText(join(statutesRoot, jur, "_versions", d.slug, `${date}.md`), renderVersion(d, text, newHash, date));
        rewrite(d, { source_sha256: newHash, checked_on: date, source_changed_on: date });
      }
      for (const a of affected) markNeedsReview(join(contentDir, a.file), a, date);
    }
    alerts.push({ kind: "source_changed", jurisdiction: jur, ref: group.map((d) => d.citation).join("; "), detail: { url, version: date, old_hash: oldHash, new_hash: newHash, changed_sections: sections.changed, removed_sections: sections.removed, added_sections: sections.added.length, affected_items: affected.map((a) => a.id) } });
    for (const a of affected) alerts.push({ kind: "quote_broken", jurisdiction: jur, ref: a.id, detail: { bank: a.bank, url, citations: group.map((d) => d.citation), reasons: a.reasons, previous_status: a.status } });
    return { ...base, status: "changed", old_hash: oldHash, new_hash: newHash, sections, affected_items: affected, version: date };
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 6, urls.length || 1)) }, worker));
  results.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || a.url.localeCompare(b.url));

  const summary = { unchanged: 0, changed: 0, baseline: 0, skipped: 0, failed: 0, docs: docs.length, sources: urls.length, no_url: noUrl, affected_items: 0 };
  for (const r of results) { summary[r.status]++; summary.affected_items += r.affected_items?.length ?? 0; }
  const report: WatchReport = { date, dry_run: dryRun, bank: opts.bank ?? null, summary, sources: results, alerts };

  writeJson(join(stateDir, "watch", `${date}${dryRun ? ".dry-run" : ""}.json`), report);
  if (!dryRun) {
    if (alerts.length) mergeAlerts(join(stateDir, "watch", "alerts.json"), alerts);
    const changed = results.filter((r) => r.status === "changed");
    if (changed.length || summary.failed) appendChangesDoc(join(docsDir, "STATUTE_CHANGES.md"), date, changed, results.filter((r) => r.status === "failed"));
  }
  return report;
}

/** Jurisdiction folders under content/statutes (skips `_versions` and dotfiles). */
function listDirs(dir: string): string[] {
  return readdirSync(dir).filter((e) => !e.startsWith(".") && !e.startsWith("_") && statSync(join(dir, e)).isDirectory()).sort();
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

function renderVersion(d: StatuteDoc, text: string, hash: string, date: string): string {
  const fm = [
    "---",
    `jurisdiction: ${JSON.stringify(d.jurisdiction)}`,
    `citation: ${JSON.stringify(d.citation)}`,
    `title: ${JSON.stringify(d.title)}`,
    `url: ${JSON.stringify(d.url)}`,
    `fetched_on: ${JSON.stringify(date)}`,
    `source_sha256: ${JSON.stringify(hash)}`,
    `supersedes_sha256: ${JSON.stringify(d.source_sha256 ?? null)}`,
    `note: "Fetched by watch-sources because the live source changed. The cached ${d.slug}.md is still what live items were verified against; re-ingest after review."`,
    "---",
    "",
  ].join("\n");
  return fm + text.trim() + "\n";
}

/** Flip an item's YAML to needs_review without disturbing anything else in the file. */
export function markNeedsReview(path: string, a: AffectedItem, date: string): void {
  const raw = readYaml<Record<string, unknown>>(path);
  raw.status = "needs_review";
  raw.review_reason = `${date}: ${a.reasons.join("; ")}`;
  writeYaml(path, raw);
}

function mergeAlerts(path: string, fresh: Alert[]): void {
  const existing = existsSync(path) ? readJson<Alert[]>(path) : [];
  const seen = new Set(existing.map((a) => JSON.stringify([a.kind, a.jurisdiction, a.ref, (a.detail as any)?.url ?? null])));
  const merged = [...existing];
  for (const a of fresh) { const k = JSON.stringify([a.kind, a.jurisdiction, a.ref, a.detail.url ?? null]); if (!seen.has(k)) { seen.add(k); merged.push(a); } }
  writeJson(path, merged);
}

export function renderChangesSection(date: string, changed: SourceResult[], failed: SourceResult[]): string {
  const lines = [`## ${date}`, ""];
  if (!changed.length) lines.push("No source text changed.", "");
  for (const r of changed) {
    lines.push(`### ${r.jurisdiction} — ${r.citations.join("; ")}`, "", `- Source: ${r.url}`, `- New text stored as version \`${r.version}\` under \`content/statutes/${r.jurisdiction}/_versions/<slug>/\`; hash ${r.old_hash?.slice(0, 12)} → ${r.new_hash?.slice(0, 12)}`);
    const s = r.sections!;
    lines.push(`- Sections changed (${s.changed.length}): ${s.changed.length ? s.changed.join(", ") : "—"}`);
    if (s.removed.length) lines.push(`- Sections no longer found (${s.removed.length}): ${s.removed.join(", ")}`);
    if (s.added.length) lines.push(`- Sections not in the cached text: ${s.added.length}${s.added.length >= 60 ? "+" : ""} (the cache may be a slice of this publication)`);
    lines.push(`- Affected items (${r.affected_items!.length}): ${r.affected_items!.length ? r.affected_items!.map((a) => `${a.id} (${a.reasons.join("; ")})`).join(", ") : "none — no live item's quote or cited section moved"}`, "");
  }
  if (failed.length) {
    lines.push(`### Fetch failures (${failed.length})`, "");
    for (const r of failed) lines.push(`- ${r.jurisdiction} ${r.citations.join("; ")} — ${r.url} — ${r.note}`);
    lines.push("");
  }
  return lines.join("\n");
}

function appendChangesDoc(path: string, date: string, changed: SourceResult[], failed: SourceResult[]): void {
  if (!existsSync(path)) writeText(path, "# Statute changes\n\nAppended by `pnpm pipeline watch-sources` whenever a cached authority's live source no longer hashes the same. Newest at the bottom. Each entry lists the source, the sections that differ and the items pulled to `needs_review`.\n\n");
  appendFileSync(path, renderChangesSection(date, changed, failed) + "\n", "utf8");
}

export function renderWatchSummary(r: WatchReport): string {
  const s = r.summary;
  const lines = [
    `watch-sources ${r.date}${r.dry_run ? " (dry run)" : ""}${r.bank ? ` bank=${r.bank}` : ""}: ${s.docs} docs from ${s.sources} sources (${s.no_url} manual, no URL)`,
    `  unchanged ${s.unchanged} · changed ${s.changed} · baseline ${s.baseline} · skipped ${s.skipped} · failed ${s.failed} · items affected ${s.affected_items} · alerts ${r.alerts.length}`,
  ];
  for (const x of r.sources.filter((x) => x.status === "changed")) lines.push(`  CHANGED ${x.jurisdiction} ${x.citations.join("; ")} — sections ${x.sections!.changed.length} changed / ${x.sections!.removed.length} removed — items ${x.affected_items!.map((a) => a.id).join(", ") || "none"}`);
  for (const x of r.sources.filter((x) => x.status === "failed")) lines.push(`  FAILED  ${x.jurisdiction} ${x.url} — ${x.note}`);
  return lines.join("\n");
}
