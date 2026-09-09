/**
 * Per-batch content delivery (SPEC §5.4). The database never holds item text; the client fetches a
 * json document for each batch through a short-lived signed url.
 *
 * Source of truth: the private `content` bucket, written by `pipeline publish --remote`:
 *
 *   items/<bank>/<item_id>.json      one object per published item = the Item schema from
 *                                    packages/schema/src/item.ts (id, jurisdiction, bank, blueprint_node,
 *                                    vendor, license_level, cognitive_level, stem, options[4] in stored
 *                                    order, key, explanation, citation, math?, terms, tags, status,
 *                                    version, ...). canary variants live under the bank their
 *                                    item_index row names, same shape, id `CAN-<16 hex>`.
 *   manifest/<version>.json          optional, mirrored by content_versions.manifest_path
 *
 * Batch document uploaded to the private `batches` bucket at `<user_id>/<batch_id>.json`:
 *
 *   { batch_id, version: "batch-v2", issued_at, items: BatchItem[], missing: public_id[] }
 *   BatchItem = { public_id, jurisdiction, bank, blueprint_node, cognitive_level, license_level,
 *                 stem, options, key, explanation, citation, math|null, terms, version }
 *
 * `key` is retained on purpose: the client grades offline and shows the explanation immediately
 * (F7). Options keep their stored order; the client may shuffle for display but must map the
 * letter back before recording answers. Stripped: id (real), reviewer, provenance, status, tags,
 * verified_on, qa_approved_on. Missing objects are reported (and dropped from the batch by the
 * caller) unless CONTENT_STUB_MISSING=true, which substitutes placeholder text for local dev.
 */
import type { Db } from "./db.ts";
import { boolEnv } from "./env.ts";
import { HttpError } from "./response.ts";

export interface BatchItemRef {
  item_id: string; // real id, server-side only
  public_id: string; // what the client sees
}

export interface BatchItem {
  public_id: string;
  jurisdiction: string;
  bank: string;
  blueprint_node: string;
  cognitive_level: string;
  license_level: string;
  stem: string;
  options: string[];
  key: "A" | "B" | "C" | "D";
  explanation: string;
  citation: unknown;
  math: unknown | null;
  terms: string[];
  version: number;
}

export interface LoadedItem extends BatchItem {
  item_id: string;
}

export interface BuiltBatch {
  path: string;
  included: BatchItemRef[];
  missing: BatchItemRef[];
}

export interface ContentStore {
  /** Read published items for the refs. Missing / malformed objects are listed, not thrown. */
  loadItems(items: BatchItemRef[]): Promise<{ items: LoadedItem[]; missing: BatchItemRef[] }>;
  /** Build and upload the batch document. Returns the storage path and what actually went in. */
  buildBatch(userId: string, batchId: string, items: BatchItemRef[]): Promise<BuiltBatch>;
  /** Signed url for a stored batch document, valid for ttlSeconds. */
  signedUrl(path: string, ttlSeconds: number): Promise<string>;
}

/** Storage object key for an item (canaries included: their bank comes from item_index). */
export function itemObjectPath(bank: string, itemId: string): string {
  return `items/${bank}/${itemId}.json`;
}

const KEYS = new Set(["A", "B", "C", "D"]);

/** Project a stored Item object onto the client shape. Returns null when the object is unusable. */
export function toBatchItem(raw: unknown, publicId: string): BatchItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.stem !== "string" || o.stem.length === 0) return null;
  if (!Array.isArray(o.options) || o.options.length !== 4 || !o.options.every((x) => typeof x === "string")) {
    return null;
  }
  if (typeof o.key !== "string" || !KEYS.has(o.key)) return null;
  if (typeof o.explanation !== "string") return null;
  return {
    public_id: publicId,
    jurisdiction: typeof o.jurisdiction === "string" ? o.jurisdiction : "",
    bank: typeof o.bank === "string" ? o.bank : "",
    blueprint_node: typeof o.blueprint_node === "string" ? o.blueprint_node : "",
    cognitive_level: typeof o.cognitive_level === "string" ? o.cognitive_level : "knowledge",
    license_level: typeof o.license_level === "string" ? o.license_level : "both",
    stem: o.stem,
    options: o.options as string[],
    key: o.key as BatchItem["key"],
    explanation: o.explanation,
    citation: o.citation ?? null,
    math: o.math ?? null,
    terms: Array.isArray(o.terms) ? o.terms.filter((t) => typeof t === "string") as string[] : [],
    version: typeof o.version === "number" ? o.version : 1,
  };
}

function stubItem(ref: BatchItemRef, bank: string): BatchItem {
  return {
    public_id: ref.public_id,
    jurisdiction: ref.item_id.split("-")[0] ?? "",
    bank,
    blueprint_node: "",
    cognitive_level: "knowledge",
    license_level: "both",
    stem: `[local stub] content object for this item is not published yet (${itemObjectPath(bank, ref.item_id)}).`,
    options: ["Option A", "Option B", "Option C", "Option D"],
    key: "A",
    explanation: "Placeholder explanation: set CONTENT_STUB_MISSING=false once `pipeline publish --remote` has run.",
    citation: null,
    math: null,
    terms: [],
    version: 0,
  };
}

async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, xs.length) }, async () => {
    while (i < xs.length) {
      const idx = i++;
      out[idx] = await fn(xs[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export class StorageContentStore implements ContentStore {
  constructor(
    private readonly db: Db,
    private readonly batchBucket: string,
    private readonly contentBucket: string = "content",
    private readonly stubMissing: boolean = boolEnv("CONTENT_STUB_MISSING", false),
  ) {}

  /** bank per item id from item_index (needed for the object path). */
  private async banksFor(itemIds: string[]): Promise<Map<string, string>> {
    const { data, error } = await this.db.from("item_index").select("item_id, bank").in("item_id", itemIds);
    if (error) throw new HttpError(500, "item_index_lookup_failed", error.message);
    return new Map((data as { item_id: string; bank: string }[]).map((r) => [r.item_id, r.bank]));
  }

  private async download(path: string): Promise<unknown | null> {
    const { data, error } = await this.db.storage.from(this.contentBucket).download(path);
    if (error || !data) return null;
    try {
      return JSON.parse(await data.text());
    } catch {
      return null;
    }
  }

  async loadItems(refs: BatchItemRef[]): Promise<{ items: LoadedItem[]; missing: BatchItemRef[] }> {
    if (refs.length === 0) return { items: [], missing: [] };
    const banks = await this.banksFor(refs.map((r) => r.item_id));
    const missing: BatchItemRef[] = [];
    const loaded = await mapLimit(refs, 16, async (ref): Promise<LoadedItem | null> => {
      const bank = banks.get(ref.item_id);
      if (!bank) {
        missing.push(ref);
        return null;
      }
      const raw = await this.download(itemObjectPath(bank, ref.item_id));
      const item = raw === null ? null : toBatchItem(raw, ref.public_id);
      if (item) return { ...item, item_id: ref.item_id };
      if (this.stubMissing) return { ...stubItem(ref, bank), item_id: ref.item_id };
      missing.push(ref);
      return null;
    });
    return { items: loaded.filter((x): x is LoadedItem => x !== null), missing };
  }

  async buildBatch(userId: string, batchId: string, refs: BatchItemRef[]): Promise<BuiltBatch> {
    const { items, missing } = await this.loadItems(refs);
    const missingIds = new Set(missing.map((m) => m.item_id));
    const included = refs.filter((r) => !missingIds.has(r.item_id));
    const path = `${userId}/${batchId}.json`;
    const doc = {
      batch_id: batchId,
      version: "batch-v2",
      issued_at: new Date().toISOString(),
      // deno-lint-ignore no-unused-vars
      items: items.map(({ item_id, ...client }) => client),
      missing: missing.map((m) => m.public_id),
    };
    const body = new Blob([JSON.stringify(doc)], { type: "application/json" });
    const { error } = await this.db.storage.from(this.batchBucket).upload(path, body, {
      contentType: "application/json",
      upsert: true,
    });
    if (error) throw new HttpError(500, "batch_upload_failed", error.message);
    return { path, included, missing };
  }

  async signedUrl(path: string, ttlSeconds: number): Promise<string> {
    const { data, error } = await this.db.storage.from(this.batchBucket).createSignedUrl(path, ttlSeconds);
    if (error || !data) throw new HttpError(500, "batch_sign_url_failed", error?.message ?? "no url");
    return data.signedUrl;
  }
}
