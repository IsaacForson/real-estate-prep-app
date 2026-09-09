/**
 * Where items come from.
 *
 *   StaticItemSource — DEV ONLY. Reads one JSON file (public/content/items.json, built from the
 *                      content repo + fixtures). It embeds real item ids and, in a dev checkout,
 *                      the whole local bank. It is what the dev server / smoke test use, and what
 *                      the anonymous free tier reads; a production build must point it at the
 *                      curated free sample (≤20 items per state + the short mock), never the bank.
 *   ApiItemSource    — production. Signed, short-TTL batches from apps/api `issue-batch`
 *                      (SPEC §5.4). The client only ever sees per-user PUBLIC ids; items are cached
 *                      in Dexie under those ids and a rolling look-ahead window is kept per bank.
 */
import type { Item } from "@rep/schema";
import { Item as ItemSchema } from "@rep/schema";
import type { StudyDb } from "./db.js";
import { ApiError, callFunction, isFreeTierError, isRateLimited, isSessionRevoked } from "./api.js";

export interface PrefetchOptions { kind?: "practice" | "mock"; formId?: string | null }

export interface ItemSource {
  /** Item ids available for a bank (for scheduling). May be a rolling window, not the whole bank. */
  ids(bank: string): Promise<string[]>;
  /** Fetch items by id (from cache or network). */
  get(ids: string[]): Promise<Item[]>;
  /** Make sure at least `count` unseen items for `bank` are cached (no-op for static sources). */
  prefetch?(bank: string, count: number, opts?: PrefetchOptions): Promise<void>;
}

export class StaticItemSource implements ItemSource {
  private all: Promise<Item[]> | null = null;
  constructor(private url: string) {}
  private load() {
    if (!this.all) this.all = fetch(this.url).then((r) => (r.ok ? (r.json() as Promise<Item[]>) : []));
    return this.all;
  }
  async ids(bank: string) { return (await this.load()).filter((i) => i.bank === bank).map((i) => i.id); }
  async get(ids: string[]) { const set = new Set(ids); return (await this.load()).filter((i) => set.has(i.id)); }
}

// ---- issue-batch ------------------------------------------------------------------------------

/** Response of apps/api `issue-batch` (see its index.ts). */
export interface IssueBatchResponse {
  batch_id: string;
  kind: "practice" | "mock";
  bank: string;
  jurisdiction: string;
  form_id: string | null;
  public_ids: string[];
  issued_at: string;
  expires_at: string;
  signature: string;
  content_url: string;
  counts: { due: number; new: number };
  free_tier: { remaining: number; total: number } | null;
  sharing_notice_ack: boolean;
}

/** Below this many unseen cached items for a bank, `ids()` asks for one more batch. */
export const LOOK_AHEAD_MIN = 30;
/** BATCH_MIN on the server; the free tier caps it further server-side. */
export const BATCH_REQUEST_SIZE = 50;
const RETRY_SHORT_MS = 60_000;
const RETRY_LONG_MS = 10 * 60_000;

/**
 * Validate one item from a batch document. Public ids are random tokens, so the id-format checks
 * in `Item` are satisfied with a placeholder during validation and the public id is put back
 * afterwards. Fields the server strips for the client (reviewer, provenance) get neutral values.
 */
export function parseBatchItem(raw: unknown, publicId: string): Item | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const jurisdiction = typeof r.jurisdiction === "string" ? r.jurisdiction : null;
  if (!jurisdiction) return null;
  const parsed = ItemSchema.safeParse({
    ...r,
    id: `${jurisdiction}-PUB-0000`,
    status: r.status ?? "published",
    reviewer: r.reviewer ?? "redacted",
    verified_on: r.verified_on ?? "1970-01-01",
    version: r.version ?? 1,
    provenance: undefined,
  });
  if (!parsed.success) return null;
  return { ...parsed.data, id: publicId };
}

/** Download and validate the batch document behind the signed url; keeps only signed public ids. */
export async function fetchBatchItems(res: IssueBatchResponse, fetchImpl: typeof fetch = fetch): Promise<Item[]> {
  const r = await fetchImpl(res.content_url);
  if (!r.ok) throw new ApiError(r.status, "batch_content_failed", `batch content ${r.status}`);
  const doc = (await r.json()) as { items?: unknown };
  const rows = Array.isArray(doc.items) ? doc.items : [];
  const allowed = new Set(res.public_ids);
  const out: Item[] = [];
  for (const raw of rows) {
    const rec = raw as Record<string, unknown> | null;
    const id = typeof rec?.id === "string" ? rec.id : typeof rec?.public_id === "string" ? rec.public_id : null;
    if (!id || !allowed.has(id)) continue;
    const item = parseBatchItem(raw, id);
    if (item) out.push(item);
  }
  if (!out.length && res.public_ids.length) {
    // the content store is still the stub (apps/api _shared/content-store.ts) or the doc is broken
    throw new ApiError(502, "batch_content_unavailable", "the batch arrived without usable items");
  }
  return out;
}

export interface ApiItemSourceDeps {
  /** `${supabaseUrl}/functions/v1` */
  base: string;
  /** Authorization + x-device-id + x-session-id, or null when not signed in / not registered. */
  headers: () => Promise<Record<string, string> | null>;
  /** The learner's home jurisdiction (free tier scope; national banks are requested for it). */
  jurisdiction: () => string;
  db: StudyDb;
  onSessionRevoked: () => void;
  onFreeTier?: (info: { remaining: number; total: number } | null) => void;
  onSharingNoticeAck?: (acked: boolean) => void;
  onError?: (e: unknown) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class ApiItemSource implements ItemSource {
  private inflight = new Map<string, Promise<string[]>>();
  private retryAfter = new Map<string, number>();
  constructor(private deps: ApiItemSourceDeps) {}

  private now() { return (this.deps.now ?? Date.now)(); }

  private async cachedIds(bank: string): Promise<{ all: string[]; unseen: number }> {
    const cached = await this.deps.db.items.where("bank").equals(bank).primaryKeys();
    const seenRows = await this.deps.db.progress.where("bank").equals(bank).toArray();
    const seen = new Set(seenRows.filter((p) => p.attempts > 0).map((p) => p.itemId));
    return { all: cached, unseen: cached.filter((id) => !seen.has(id)).length };
  }

  /** Cached ids for the bank, topping up the look-ahead window with one batch when it runs low. */
  async ids(bank: string): Promise<string[]> {
    const { all, unseen } = await this.cachedIds(bank);
    if (unseen >= LOOK_AHEAD_MIN || this.now() < (this.retryAfter.get(bank) ?? 0)) return all;
    const fresh = await this.issue(bank, { kind: "practice", size: BATCH_REQUEST_SIZE });
    const set = new Set(all);
    return [...all, ...fresh.filter((id) => !set.has(id))];
  }

  /** Cache only: the API has no fetch-by-id. Anything not cached was never issued to this user. */
  async get(ids: string[]): Promise<Item[]> {
    const rows = await this.deps.db.items.bulkGet(ids);
    return rows.filter((r): r is NonNullable<typeof r> => !!r).map((r) => r.item);
  }

  /** Keep issuing (bounded) until `count` unseen items are cached or the server has nothing left. */
  async prefetch(bank: string, count: number, opts: PrefetchOptions = {}): Promise<void> {
    for (let i = 0; i < 4; i++) {
      const { unseen } = await this.cachedIds(bank);
      if (unseen >= count) return;
      const size = opts.kind === "mock" ? Math.max(1, count - unseen) : Math.max(BATCH_REQUEST_SIZE, Math.min(200, count - unseen));
      const got = await this.issue(bank, { kind: opts.kind ?? "practice", size, formId: opts.formId ?? null });
      if (!got.length) return;
    }
  }

  private issue(bank: string, o: { kind: "practice" | "mock"; size: number; formId?: string | null }): Promise<string[]> {
    const key = `${bank}:${o.kind}:${o.formId ?? ""}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.issueNow(bank, o).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async issueNow(bank: string, o: { kind: "practice" | "mock"; size: number; formId?: string | null }): Promise<string[]> {
    const headers = await this.deps.headers();
    if (!headers) return [];
    const jurisdiction = bank.startsWith("state_") ? bank.slice(6) : this.deps.jurisdiction() || "NAT";
    const body: Record<string, unknown> = { bank, jurisdiction, kind: o.kind, size: o.size };
    if (o.kind === "mock") body.form_id = o.formId;
    try {
      const res = await callFunction<IssueBatchResponse>(this.deps.base, "issue-batch", body, headers, this.deps.fetchImpl);
      const items = await fetchBatchItems(res, this.deps.fetchImpl);
      const expiresAt = Date.parse(res.expires_at);
      const cachedAt = this.now();
      await this.deps.db.items.bulkPut(items.map((item) => ({
        id: item.id, bank: item.bank, node: item.blueprint_node, item, cachedAt, batchId: res.batch_id,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
      })));
      this.deps.onFreeTier?.(res.free_tier);
      this.deps.onSharingNoticeAck?.(res.sharing_notice_ack);
      // a short batch means the scope is nearly exhausted: do not hammer the hourly batch limit
      this.retryAfter.set(bank, cachedAt + (items.length < o.size ? RETRY_LONG_MS : RETRY_SHORT_MS));
      return items.map((i) => i.id);
    } catch (e) {
      if (isSessionRevoked(e)) { this.deps.onSessionRevoked(); this.retryAfter.set(bank, this.now() + RETRY_LONG_MS); return []; }
      if (isFreeTierError(e)) {
        this.retryAfter.set(bank, this.now() + RETRY_LONG_MS);
        if (e.code === "free_tier_exhausted") this.deps.onFreeTier?.({ remaining: 0, total: 20 });
        return [];
      }
      if (isRateLimited(e)) {
        const resets = typeof e.extra.resets_at === "string" ? Date.parse(e.extra.resets_at) : NaN;
        this.retryAfter.set(bank, Number.isFinite(resets) ? resets : this.now() + RETRY_LONG_MS);
        return [];
      }
      if (e instanceof ApiError && e.code === "no_items") { this.retryAfter.set(bank, this.now() + RETRY_LONG_MS); return []; }
      this.retryAfter.set(bank, this.now() + RETRY_SHORT_MS);
      this.deps.onError?.(e);
      return [];
    }
  }
}
