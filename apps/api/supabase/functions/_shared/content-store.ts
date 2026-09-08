/**
 * Per-batch content delivery (SPEC §5.4). The database never holds item text; the client fetches
 * a json document for each batch through a short-lived signed url.
 *
 * Contract: for a batch, produce a json object keyed by *public* id whose values are the item
 * fields the client needs (stem, options, explanation, citation, audio urls, ...) and store it
 * in the private `batches` bucket at `<user_id>/<batch_id>.json`. Then hand back a signed url.
 *
 * TODO(content): implement StorageContentStore.buildBatch — read the published items from the
 * content bucket (the pipeline's publish step writes `content/<bank>/<item_id>.json`, one object
 * per item, plus `content/canaries/<item_id>.json` for canary variants), strip anything the
 * client must not see (reviewer ids, provenance, real item id), re-key by public_id and upload.
 * Until then the stub uploads a document that carries only the public ids so the whole flow is
 * exercisable end to end locally.
 */
import type { Db } from "./db.ts";
import { HttpError } from "./response.ts";

export interface BatchItemRef {
  item_id: string; // real id, server-side only
  public_id: string; // what the client sees
}

export interface ContentStore {
  /** Build and upload the batch document. Returns the storage path. */
  buildBatch(userId: string, batchId: string, items: BatchItemRef[]): Promise<string>;
  /** Signed url for a stored batch document, valid for ttlSeconds. */
  signedUrl(path: string, ttlSeconds: number): Promise<string>;
}

export class StorageContentStore implements ContentStore {
  constructor(private readonly db: Db, private readonly bucket: string) {}

  async buildBatch(userId: string, batchId: string, items: BatchItemRef[]): Promise<string> {
    const path = `${userId}/${batchId}.json`;
    // TODO(content): replace this stub body with the real per-item content (see file header).
    const doc = {
      batch_id: batchId,
      version: "stub-1",
      items: items.map((i) => ({ public_id: i.public_id, stem: null, options: null, key: null, explanation: null })),
      note: "content delivery not wired yet; see _shared/content-store.ts",
    };
    const body = new Blob([JSON.stringify(doc)], { type: "application/json" });
    const { error } = await this.db.storage.from(this.bucket).upload(path, body, {
      contentType: "application/json",
      upsert: true,
    });
    if (error) throw new HttpError(500, "batch_upload_failed", error.message);
    return path;
  }

  async signedUrl(path: string, ttlSeconds: number): Promise<string> {
    const { data, error } = await this.db.storage.from(this.bucket).createSignedUrl(path, ttlSeconds);
    if (error || !data) throw new HttpError(500, "batch_sign_url_failed", error?.message ?? "no url");
    return data.signedUrl;
  }
}
