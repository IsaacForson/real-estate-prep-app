/**
 * POST /functions/v1/issue-batch — server-paced item delivery (SPEC §5.4).
 *
 * headers: Authorization: Bearer <jwt>, x-device-id, x-session-id
 * body:    { bank, jurisdiction, kind?: "practice"|"mock", size?: 50..200, nodes?: string[], form_id?: string }
 * returns: { batch_id, public_ids[], issued_at, expires_at, signature, content_url, counts, free_tier }
 *
 * checks, in order: jwt → single live session → free-tier scope (SPEC §6) → hourly rate limits →
 * candidate selection (due srs items first, then look-ahead by blueprint node) → per-user public
 * ids → batch json in the private bucket behind a signed url → hmac signature → item_batches row.
 */
import {
  audit,
  authenticate,
  enforceRateLimit,
  getEntitlements,
  getProfile,
  recordGeo,
  requireSession,
} from "../_shared/auth.ts";
import { type Candidate, clampBatchSize, selectBatchItems } from "../_shared/batch.ts";
import { StorageContentStore } from "../_shared/content-store.ts";
import { rpc, unwrap } from "../_shared/db.ts";
import { intEnv, optionalEnv, requireEnv } from "../_shared/env.ts";
import { type BatchClaims, signBatch } from "../_shared/hmac.ts";
import {
  BATCH_MAX,
  BATCH_MIN,
  BATCH_TTL_SECONDS_DEFAULT,
  BATCHES_PER_HOUR,
  CANARIES_PER_ACCOUNT,
  FREE_TIER_ITEMS,
  FREE_TIER_MOCK_FORM,
  FREE_TIER_MOCKS,
  ITEMS_PER_HOUR,
  RATE_WINDOW_SECONDS,
} from "../_shared/limits.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";

interface IssueBatchRequest extends Record<string, unknown> {
  bank?: unknown;
  jurisdiction?: unknown;
  kind?: unknown;
  size?: unknown;
  nodes?: unknown;
  form_id?: unknown;
}

const BANK_RE = /^(national_pearsonvue|national_psi|state_[A-Z]{2})$/;
const JUR_RE = /^(NAT|[A-Z]{2})$/;
const NODE_RE = /^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/;

serve(async (req) => {
  const ctx = await authenticate(req);
  await requireSession(ctx);
  const body = await readJsonObject<IssueBatchRequest>(req);

  // ---- validate -------------------------------------------------------------------------
  if (typeof body.bank !== "string" || !BANK_RE.test(body.bank)) throw new HttpError(400, "invalid_bank");
  if (typeof body.jurisdiction !== "string" || !JUR_RE.test(body.jurisdiction)) {
    throw new HttpError(400, "invalid_jurisdiction");
  }
  const kind = body.kind === undefined ? "practice" : body.kind;
  if (kind !== "practice" && kind !== "mock") throw new HttpError(400, "invalid_kind");
  let nodes: string[] | null = null;
  if (body.nodes !== undefined) {
    if (
      !Array.isArray(body.nodes) || body.nodes.length > 50 ||
      !body.nodes.every((n) => typeof n === "string" && NODE_RE.test(n))
    ) {
      throw new HttpError(400, "invalid_nodes");
    }
    nodes = body.nodes as string[];
  }
  const formId = body.form_id === undefined || body.form_id === null ? null : body.form_id;
  if (formId !== null && (typeof formId !== "string" || formId.length > 64)) {
    throw new HttpError(400, "invalid_form_id");
  }
  if (kind === "mock" && !formId) throw new HttpError(400, "form_id_required", "mocks are delivered per form (F11)");
  const bank = body.bank;
  const jurisdiction = body.jurisdiction;
  if (bank.startsWith("state_") && bank.slice(6) !== jurisdiction) {
    throw new HttpError(400, "bank_jurisdiction_mismatch");
  }

  await recordGeo(ctx, "issue-batch");
  const [profile, ent] = await Promise.all([getProfile(ctx.db, ctx.userId), getEntitlements(ctx.db, ctx.userId)]);
  const paid = ent.complete;

  // ---- free tier (SPEC §6: 40 questions, one state, 1 short mock) -----------------------
  let cap: number | null = null;
  if (!paid) {
    const home = profile.home_jurisdiction;
    if (!home) throw new HttpError(403, "home_jurisdiction_required", "choose your state before studying");
    const inScope = bank === `state_${home}` ||
      (bank.startsWith("national_") && (jurisdiction === home || jurisdiction === "NAT"));
    if (!inScope) {
      throw new HttpError(
        403,
        "free_tier_one_state",
        `the free tier covers ${home} only. complete unlocks all 51 jurisdictions.`,
      );
    }
    if (kind === "mock") {
      if (formId !== FREE_TIER_MOCK_FORM) {
        throw new HttpError(
          403,
          "free_tier_mock_form",
          `the free tier includes the "${FREE_TIER_MOCK_FORM}" mock only`,
        );
      }
      const mocks = unwrap(
        await ctx.db.from("item_batches").select("form_id").eq("user_id", ctx.userId).eq("kind", "mock"),
        "mock_batches_lookup",
      ) as { form_id: string | null }[];
      const forms = new Set(mocks.map((m) => m.form_id));
      if (!forms.has(formId) && forms.size >= FREE_TIER_MOCKS) {
        throw new HttpError(403, "free_tier_mock_limit", "the free tier includes one mock exam");
      }
    }
    const seen = await rpc<number>(ctx.db, "fn_items_delivered_count", { p_user_id: ctx.userId });
    cap = Math.max(0, FREE_TIER_ITEMS - seen);
    if (cap === 0) {
      throw new HttpError(
        402,
        "free_tier_exhausted",
        `you have used the ${FREE_TIER_ITEMS} free questions. complete is $59 once, forever.`,
      );
    }
  }

  // mocks carry their own fixed length (F11), practice batches are 50–200 (SPEC §5.4).
  const size = clampBatchSize(body.size, { min: kind === "mock" ? 1 : BATCH_MIN, max: BATCH_MAX, cap });

  // ---- rate limits: plausible human ceiling per hour (SPEC §5.4) ------------------------
  await enforceRateLimit(ctx.db, `batches:${ctx.userId}`, BATCHES_PER_HOUR, RATE_WINDOW_SECONDS, 1);
  await enforceRateLimit(ctx.db, `items:${ctx.userId}`, ITEMS_PER_HOUR, RATE_WINDOW_SECONDS, size);

  // ---- select ---------------------------------------------------------------------------
  // TODO(forms): for kind = "mock" the item list should come from the form definition in the
  // content repo (5 non-overlapping forms per state). until then a mock is a fresh-only batch.
  const candidates = await rpc<Candidate[]>(ctx.db, "fn_batch_candidates", {
    p_user_id: ctx.userId,
    p_bank: bank,
    p_nodes: nodes,
    p_due_limit: kind === "mock" ? 0 : size,
    p_new_limit: size * 2,
  });
  // canaries only for paid accounts; a free account's 40 items are not the leak vector.
  const canaries = paid && kind === "practice"
    ? await rpc<string[]>(ctx.db, "fn_ensure_canaries", { p_user_id: ctx.userId, p_count: CANARIES_PER_ACCOUNT })
    : [];
  const selection = selectBatchItems({
    due: kind === "mock" ? [] : candidates.filter((c) => c.source === "due"),
    fresh: candidates.filter((c) => c.source === "new"),
    canaries,
    size,
  });
  if (selection.item_ids.length === 0) {
    throw new HttpError(404, "no_items", "nothing is due and nothing is left unseen in this scope");
  }

  // ---- alias + content + sign -----------------------------------------------------------
  const aliasRows = await rpc<{ item_id: string; public_id: string }[]>(ctx.db, "fn_alias_items", {
    p_user_id: ctx.userId,
    p_item_ids: selection.item_ids,
  });
  const alias = new Map(aliasRows.map((r) => [r.item_id, r.public_id]));
  const refs = selection.item_ids.map((id) => {
    const pub = alias.get(id);
    if (!pub) throw new HttpError(500, "alias_missing", `no public id for ${id}`);
    return { item_id: id, public_id: pub };
  });

  const batchId = crypto.randomUUID();
  const ttl = intEnv("BATCH_TTL_SECONDS", BATCH_TTL_SECONDS_DEFAULT);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttl * 1000);

  const store = new StorageContentStore(ctx.db, optionalEnv("BATCH_BUCKET", "batches"));
  const contentPath = await store.buildBatch(ctx.userId, batchId, refs);
  const contentUrl = await store.signedUrl(contentPath, ttl);

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
      kind,
      bank,
      jurisdiction,
      form_id: formId,
      item_ids: refs.map((r) => r.item_id),
      public_ids: claims.public_ids,
      issued_at: claims.issued_at,
      expires_at: claims.expires_at,
      signature,
      content_path: contentPath,
    }).select("id").single(),
    "item_batches_insert",
  );

  // audit_log is readable by the owner: never mention canaries there.
  await audit(ctx, "batch.issued", batchId, { kind, bank, size: refs.length, due: selection.due_count });

  return json({
    batch_id: batchId,
    kind,
    bank,
    jurisdiction,
    form_id: formId,
    public_ids: claims.public_ids,
    issued_at: claims.issued_at,
    expires_at: claims.expires_at,
    signature,
    content_url: contentUrl,
    counts: { due: selection.due_count, new: refs.length - selection.due_count },
    free_tier: paid ? null : { remaining: Math.max(0, (cap ?? 0) - refs.length), total: FREE_TIER_ITEMS },
    // SPEC §5.2: the client shows the one-person notice until acknowledged.
    sharing_notice_ack: profile.sharing_notice_ack,
  });
});
