/**
 * `pipeline publish --remote [<bank>] [--dry-run]` — push approved content to Supabase (V2 §1, §6.3).
 *
 *   storage  content/items/<bank>/<item_id>.json   full Item JSON (options in stored order, key kept;
 *                                                  the API strips reviewer/provenance before delivery)
 *   table    item_index                            upsert one row per item (status 'published')
 *   table    content_versions                      one row per run that changed something
 *   table    content_alerts                        rows from .pipeline/watch/alerts.json, if present
 *
 * Idempotent: `.pipeline/publish/remote-manifest.json` remembers the sha256 of every object uploaded;
 * unchanged items are skipped, items that left the publishable set are retired in item_index.
 * Credentials: SUPABASE_URL (or NUXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY from the
 * environment / repo-root .env. Their values are never logged.
 */
import { join } from "node:path";
import { existsSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import type { Item } from "@rep/schema";
import { loadItems } from "@rep/content-lint";
import { CONFIG } from "./config.js";
import { readJson, writeJson } from "./fsx.js";
import { sha256Hex } from "./hash.js";
import type { Alert } from "./watch.js";

export const PUBLISHABLE: ReadonlySet<Item["status"]> = new Set<Item["status"]>(["qa_approved", "published"]);
export const CONTENT_BUCKET = "content";

export interface IndexRow {
  item_id: string; bank: string; jurisdiction: string; blueprint_node: string;
  cognitive_level: Item["cognitive_level"]; license_level: Item["license_level"];
  status: "published" | "retired"; content_version: number;
}
export interface ManifestEntry { sha256: string; path: string; row: IndexRow; published_at: string }
export interface RemoteManifest { updated: string | null; items: Record<string, ManifestEntry> }

export interface PublishPlan {
  upload: { item: Item; body: string; sha256: string; path: string; row: IndexRow }[];
  skipped: string[];
  /** ids in the manifest that are no longer publishable (retired / pulled to needs_review / deleted) */
  unpublish: ManifestEntry[];
}

export function objectPath(item: Pick<Item, "bank" | "id">): string { return `items/${item.bank}/${item.id}.json`; }

/** Deterministic body: the parsed Item's field order, options exactly as stored, key retained. */
export function serializeItem(item: Item): string { return JSON.stringify(item); }

export function indexRow(item: Item): IndexRow {
  return { item_id: item.id, bank: item.bank, jurisdiction: item.jurisdiction, blueprint_node: item.blueprint_node, cognitive_level: item.cognitive_level, license_level: item.license_level, status: "published", content_version: item.version };
}

export function planPublish(items: Item[], manifest: RemoteManifest, bank?: string): PublishPlan {
  const plan: PublishPlan = { upload: [], skipped: [], unpublish: [] };
  const live = new Set<string>();
  for (const item of items) {
    if (!PUBLISHABLE.has(item.status)) continue;
    if (bank && item.bank !== bank) continue;
    live.add(item.id);
    const body = serializeItem(item);
    const sha256 = sha256Hex(body);
    const prev = manifest.items[item.id];
    if (prev && prev.sha256 === sha256 && prev.row.status === "published") { plan.skipped.push(item.id); continue; }
    plan.upload.push({ item, body, sha256, path: objectPath(item), row: indexRow(item) });
  }
  for (const [id, entry] of Object.entries(manifest.items)) {
    if (live.has(id) || entry.row.status === "retired") continue;
    if (bank && entry.row.bank !== bank) continue;
    plan.unpublish.push(entry);
  }
  return plan;
}

/** `2026-09-09T0312+e73b82f` — minute precision so repeated publishes on one commit never collide. */
export function versionTag(date: string, gitSha: string, now: Date = new Date()): string {
  const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
  return `${date}T${hhmm}+${gitSha}`;
}

export function shortGitSha(): string {
  try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "nogit"; } catch { return "nogit"; }
}

/** Thin Supabase REST client (Storage + PostgREST) over fetch; no SDK so the pipeline stays dependency-light. */
export class SupabaseRemote {
  constructor(private readonly url: string, private readonly key: string, private readonly fetchImpl: typeof fetch = fetch) {
    if (!/^https?:\/\//.test(url)) throw new Error("SUPABASE_URL must be an http(s) URL");
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is empty");
  }
  private headers(extra: Record<string, string> = {}) { return { apikey: this.key, authorization: `Bearer ${this.key}`, ...extra }; }

  async uploadObject(bucket: string, path: string, body: string, contentType = "application/json"): Promise<void> {
    const res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/storage/v1/object/${bucket}/${path}`, { method: "POST", headers: this.headers({ "content-type": contentType, "x-upsert": "true", "cache-control": "3600" }), body });
    if (!res.ok) throw new Error(`storage upload ${path} → ${res.status} ${(await safeText(res)).slice(0, 200)}`);
  }

  /** Insert/merge rows; returns "missing" when the table does not exist yet (PostgREST PGRST205 / Postgres 42P01 / 404). */
  async writeRows(table: string, rows: unknown[], mode: "insert" | "upsert"): Promise<"ok" | "missing"> {
    if (!rows.length) return "ok";
    const prefer = mode === "upsert" ? "resolution=merge-duplicates,return=minimal" : "return=minimal";
    const res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/rest/v1/${table}`, { method: "POST", headers: this.headers({ "content-type": "application/json", prefer }), body: JSON.stringify(rows) });
    if (res.ok) return "ok";
    const text = await safeText(res);
    if (res.status === 404 || /PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(text)) return "missing";
    throw new Error(`${table} ${mode} → ${res.status} ${text.slice(0, 300)}`);
  }
}

async function safeText(res: Response): Promise<string> { try { return await res.text(); } catch { return ""; } }

export interface PublishRemoteOptions {
  bank?: string;
  dryRun?: boolean;
  remote?: SupabaseRemote;
  contentDir?: string;
  stateDir?: string;
  gitSha?: string;
  today?: string;
  /** Insert a content_versions row even when nothing changed. */
  forceVersion?: boolean;
  log?: (line: string) => void;
}
export interface PublishRemoteResult {
  version: string | null; uploaded: number; skipped: number; unpublished: number; alerts: number; warnings: string[]; dry_run: boolean;
}

export function emptyManifest(): RemoteManifest { return { updated: null, items: {} }; }

export function remoteFromEnv(fetchImpl?: typeof fetch): SupabaseRemote {
  const url = process.env.SUPABASE_URL ?? process.env.NUXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("publish --remote needs SUPABASE_URL (or NUXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in the environment or the repo-root .env");
  return new SupabaseRemote(url, key, fetchImpl);
}

export async function publishRemote(opts: PublishRemoteOptions = {}): Promise<PublishRemoteResult> {
  const contentDir = opts.contentDir ?? CONFIG.contentDir;
  const stateDir = opts.stateDir ?? CONFIG.stateDir;
  const log = opts.log ?? (() => {});
  const dryRun = !!opts.dryRun;
  const manifestPath = join(stateDir, "publish", "remote-manifest.json");
  const manifest: RemoteManifest = existsSync(manifestPath) ? readJson<RemoteManifest>(manifestPath) : emptyManifest();
  const items = loadItems(contentDir).items.map((x) => x.value);
  const plan = planPublish(items, manifest, opts.bank);
  const warnings: string[] = [];
  const date = opts.today ?? new Date().toISOString().slice(0, 10);
  const version = versionTag(date, opts.gitSha ?? shortGitSha());
  const alertsPath = join(stateDir, "watch", "alerts.json");
  const alerts: Alert[] = existsSync(alertsPath) ? readJson<Alert[]>(alertsPath) : [];

  log(`publish --remote${dryRun ? " (dry run)" : ""}: ${plan.upload.length} to upload, ${plan.skipped.length} unchanged, ${plan.unpublish.length} to retire, ${alerts.length} alerts pending${opts.bank ? ` (bank ${opts.bank})` : ""}`);
  if (dryRun) {
    for (const u of plan.upload.slice(0, 20)) log(`  would upload ${u.path}`);
    if (plan.upload.length > 20) log(`  … ${plan.upload.length - 20} more`);
    for (const u of plan.unpublish) log(`  would retire ${u.row.item_id}`);
    return { version: plan.upload.length || plan.unpublish.length ? version : null, uploaded: plan.upload.length, skipped: plan.skipped.length, unpublished: plan.unpublish.length, alerts: alerts.length, warnings, dry_run: true };
  }

  const remote = opts.remote ?? remoteFromEnv();
  const now = new Date().toISOString();
  let uploaded = 0;
  try {
    // 1. objects, then their index rows in batches — manifest updated per success so a crash resumes cleanly
    const batch: IndexRow[] = [];
    const flushIndex = async () => {
      if (!batch.length) return;
      const r = await remote.writeRows("item_index", batch.splice(0), "upsert");
      if (r === "missing") warnings.push("item_index table not found — index rows not written");
    };
    for (const u of plan.upload) {
      await remote.uploadObject(CONTENT_BUCKET, u.path, u.body);
      manifest.items[u.item.id] = { sha256: u.sha256, path: u.path, row: u.row, published_at: now };
      batch.push(u.row);
      uploaded++;
      if (batch.length >= 200) await flushIndex();
    }
    await flushIndex();

    // 2. retire rows for items that left the publishable set (object left in place; the API filters on item_index)
    if (plan.unpublish.length) {
      const rows = plan.unpublish.map((e) => ({ ...e.row, status: "retired" as const }));
      const r = await remote.writeRows("item_index", rows, "upsert");
      if (r === "missing") warnings.push("item_index table not found — retirements not written");
      else for (const e of plan.unpublish) manifest.items[e.row.item_id] = { ...e, row: { ...e.row, status: "retired" } };
    }

    // 3. a content_versions row when anything moved (the app polls this table to refresh its cache)
    let versionWritten: string | null = null;
    if (uploaded || plan.unpublish.length || opts.forceVersion) {
      const liveCount = Object.values(manifest.items).filter((e) => e.row.status === "published").length;
      const banks = [...new Set(plan.upload.map((u) => u.item.bank))].sort();
      const notes = `${uploaded} uploaded, ${plan.skipped.length} unchanged, ${plan.unpublish.length} retired${banks.length ? `; banks: ${banks.join(", ")}` : ""}`;
      const r = await remote.writeRows("content_versions", [{ version, published_at: now, item_count: liveCount, notes }], "insert");
      if (r === "missing") warnings.push("content_versions table not found (WP-A migration pending) — version row not written");
      else versionWritten = version;
    }

    // 4. alerts from watch-sources
    let alertsSent = 0;
    if (alerts.length) {
      const r = await remote.writeRows("content_alerts", alerts.map((a) => ({ kind: a.kind, jurisdiction: a.jurisdiction, ref: a.ref, detail: a.detail, status: "open" })), "insert");
      if (r === "missing") warnings.push(`content_alerts table not found (WP-A migration pending) — ${alerts.length} alerts kept in ${alertsPath}`);
      else { alertsSent = alerts.length; renameSync(alertsPath, join(stateDir, "watch", `alerts.${now.replace(/[:.]/g, "-")}.sent.json`)); }
    }
    return { version: versionWritten, uploaded, skipped: plan.skipped.length, unpublished: plan.unpublish.length, alerts: alertsSent, warnings, dry_run: false };
  } finally {
    manifest.updated = now;
    writeJson(manifestPath, manifest);
  }
}
