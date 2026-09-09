/**
 * Batch issuance shared by issue-batch (practice / legacy mock) and mock-start (server-built mocks):
 * candidates → selection → per-user public ids → content document → hmac signature → item_batches row.
 * Callers do validation, free-tier and rate-limit checks first.
 */
import type { AuthContext } from "./auth.ts";
import { type Candidate, selectBatchItems } from "./batch.ts";
import { type BatchItemRef, StorageContentStore } from "./content-store.ts";
import { rpc, unwrap } from "./db.ts";
import { intEnv, optionalEnv, requireEnv } from "./env.ts";
import { type BatchClaims, signBatch } from "./hmac.ts";
import { BATCH_TTL_SECONDS_DEFAULT, CANARIES_PER_ACCOUNT } from "./limits.ts";
import { HttpError } from "./response.ts";

export interface IssueParams {
  bank: string;
  jurisdiction: string;
  kind: "practice" | "mock";
  size: number;
  nodes: string[] | null;
  formId: string | null;
  /** canaries only for paid practice batches (SPEC §5.4) */
  paid: boolean;
  deviceHash: string | null;
}

export interface IssuedBatch {
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
  counts: { due: number; new: number; missing: number };
  /** server-side only, never returned to the client */
  refs: BatchItemRef[];
}

export function contentStore(ctx: AuthContext): StorageContentStore {
  return new StorageContentStore(
    ctx.db,
    optionalEnv("BATCH_BUCKET", "batches"),
    optionalEnv("CONTENT_BUCKET", "content"),
  );
}

/** Issue one batch for one bank. Throws 404 no_items when nothing is available. */
export async function issueBatch(ctx: AuthContext, p: IssueParams): Promise<IssuedBatch> {
  const candidates = await rpc<Candidate[]>(ctx.db, "fn_batch_candidates", {
    p_user_id: ctx.userId,
    p_bank: p.bank,
    p_nodes: p.nodes,
    p_due_limit: p.kind === "mock" ? 0 : p.size,
    p_new_limit: p.size * 2,
  });
  const canaries = p.paid && p.kind === "practice"
    ? await rpc<string[]>(ctx.db, "fn_ensure_canaries", { p_user_id: ctx.userId, p_count: CANARIES_PER_ACCOUNT })
    : [];
  const selection = selectBatchItems({
    due: p.kind === "mock" ? [] : candidates.filter((c) => c.source === "due"),
    fresh: candidates.filter((c) => c.source === "new"),
    canaries,
    size: p.size,
  });
  if (selection.item_ids.length === 0) {
    throw new HttpError(404, "no_items", "nothing is due and nothing is left unseen in this scope");
  }

  const aliasRows = await rpc<{ item_id: string; public_id: string }[]>(ctx.db, "fn_alias_items", {
    p_user_id: ctx.userId,
    p_item_ids: selection.item_ids,
  });
  const alias = new Map(aliasRows.map((r) => [r.item_id, r.public_id]));
  const allRefs = selection.item_ids.map((id) => {
    const pub = alias.get(id);
    if (!pub) throw new HttpError(500, "alias_missing", `no public id for ${id}`);
    return { item_id: id, public_id: pub };
  });

  const batchId = crypto.randomUUID();
  const ttl = intEnv("BATCH_TTL_SECONDS", BATCH_TTL_SECONDS_DEFAULT);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttl * 1000);

  // content first: items whose object is not in the bucket are dropped *before* signing so the
  // signature, the row and the document always agree.
  const store = contentStore(ctx);
  const built = await store.buildBatch(ctx.userId, batchId, allRefs);
  if (built.included.length === 0) {
    throw new HttpError(503, "content_unavailable", "items are selected but their content is not published yet");
  }
  const refs = built.included;
  const contentUrl = await store.signedUrl(built.path, ttl);

  const claims: BatchClaims = {
    batch_id: batchId,
    user_id: ctx.userId,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    public_ids: refs.map((r) => r.public_id),
  };
  const signature = await signBatch(claims, requireEnv("BATCH_SIGNING_SECRET"));

  unwrap(
    await ctx.db.from("item_batches").insert({
      id: batchId,
      user_id: ctx.userId,
      session_id: ctx.sessionId,
      device_id: ctx.deviceId,
      kind: p.kind,
      bank: p.bank,
      jurisdiction: p.jurisdiction,
      form_id: p.formId,
      item_ids: refs.map((r) => r.item_id),
      public_ids: claims.public_ids,
      issued_at: claims.issued_at,
      expires_at: claims.expires_at,
      signature,
      content_path: built.path,
    }).select("id").single(),
    "item_batches_insert",
  );

  const dueIds = new Set(candidates.filter((c) => c.source === "due").map((c) => c.item_id));
  const due = refs.filter((r) => dueIds.has(r.item_id)).length;
  return {
    batch_id: batchId,
    kind: p.kind,
    bank: p.bank,
    jurisdiction: p.jurisdiction,
    form_id: p.formId,
    public_ids: claims.public_ids,
    issued_at: claims.issued_at,
    expires_at: claims.expires_at,
    signature,
    content_url: contentUrl,
    counts: { due, new: refs.length - due, missing: built.missing.length },
    refs,
  };
}

/** The client-facing subset of an issued batch. */
// deno-lint-ignore no-unused-vars
export function publicBatch({ refs, ...rest }: IssuedBatch): Omit<IssuedBatch, "refs"> {
  return rest;
}
