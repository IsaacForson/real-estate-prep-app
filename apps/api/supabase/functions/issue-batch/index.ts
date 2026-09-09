/**
 * POST /functions/v1/issue-batch — server-paced item delivery (SPEC §5.4).
 *
 * headers: Authorization: Bearer <jwt>, x-device-id, x-session-id, x-device-hash
 * body:    { bank, jurisdiction, kind?: "practice"|"mock", size?: 50..200, nodes?: string[], form_id?: string }
 * returns: { batch_id, public_ids[], issued_at, expires_at, signature, content_url, counts, free_tier }
 *
 * checks, in order: jwt → single live session → device fingerprint (V2 §1) → free tier as
 * max(account, device) (SPEC §6 + V2 §1) → hourly rate limits → candidate selection (due srs items
 * first, then look-ahead by blueprint node) → per-user public ids → real item json from the content
 * bucket behind a signed url → hmac signature → item_batches row → free_tier_usage + events.
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
import { clampBatchSize } from "../_shared/batch.ts";
import { bumpFreeTier, deviceFromRequest, freeTierFor } from "../_shared/device.ts";
import { emitEvent } from "../_shared/events.ts";
import { issueBatch, publicBatch } from "../_shared/issue.ts";
import {
  BATCH_MAX,
  BATCH_MIN,
  BATCHES_PER_HOUR,
  FREE_TIER_ITEMS,
  FREE_TIER_MOCK_FORM,
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
  const [profile, ent, { deviceHash, touch }] = await Promise.all([
    getProfile(ctx.db, ctx.userId),
    getEntitlements(ctx.db, ctx.userId),
    deviceFromRequest(req, ctx),
  ]);
  const paid = ent.complete;

  // ---- free tier (SPEC §6: 40 questions, one state, 1 short mock; V2 §1: per device too) -------
  let cap: number | null = null;
  let free: Awaited<ReturnType<typeof freeTierFor>> | null = null;
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
    free = await freeTierFor(ctx.db, ctx.userId, deviceHash, home, touch);
    if (free.reason === "device_blocked" || free.reason === "device_shared") {
      await emitEvent(ctx.db, ctx.userId, deviceHash, "free_tier_blocked", {
        reason: free.reason,
        source: "issue-batch",
      });
      throw new HttpError(
        402,
        "free_tier_exhausted",
        "the free tier on this device has been used up. complete is $59 once, forever.",
        { reason: free.reason, free_tier: { remaining: 0, total: FREE_TIER_ITEMS } },
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
      if (free.mocks_remaining === 0) {
        throw new HttpError(402, "free_tier_exhausted", "the free tier includes one mock exam", {
          reason: "mocks",
          free_tier: { remaining: free.questions_remaining, total: FREE_TIER_ITEMS, mocks_remaining: 0 },
        });
      }
    }
    cap = free.questions_remaining;
    if (cap === 0) {
      throw new HttpError(
        402,
        "free_tier_exhausted",
        `you have used the ${FREE_TIER_ITEMS} free questions. complete is $59 once, forever.`,
        { reason: "questions", free_tier: { remaining: 0, total: FREE_TIER_ITEMS } },
      );
    }
  }

  // mocks carry their own fixed length (F11), practice batches are 50–200 (SPEC §5.4).
  const size = clampBatchSize(body.size, { min: kind === "mock" ? 1 : BATCH_MIN, max: BATCH_MAX, cap });

  // ---- rate limits: plausible human ceiling per hour (SPEC §5.4) ------------------------
  await enforceRateLimit(ctx.db, `batches:${ctx.userId}`, BATCHES_PER_HOUR, RATE_WINDOW_SECONDS, 1);
  await enforceRateLimit(ctx.db, `items:${ctx.userId}`, ITEMS_PER_HOUR, RATE_WINDOW_SECONDS, size);

  // ---- select + alias + content + sign ---------------------------------------------------
  const batch = await issueBatch(ctx, { bank, jurisdiction, kind, size, nodes, formId, paid, deviceHash });

  // ---- bookkeeping ----------------------------------------------------------------------
  const scope = profile.home_jurisdiction ?? (jurisdiction === "NAT" ? "NAT" : jurisdiction);
  await bumpFreeTier(ctx.db, ctx.userId, deviceHash, scope, batch.refs.length, kind === "mock" ? 1 : 0);
  await emitEvent(ctx.db, ctx.userId, deviceHash, "batch_issued", {
    batch_id: batch.batch_id,
    kind,
    bank,
    jurisdiction,
    form_id: formId,
    size: batch.refs.length,
    due: batch.counts.due,
  });
  // audit_log is readable by the owner: never mention canaries there.
  await audit(ctx, "batch.issued", batch.batch_id, { kind, bank, size: batch.refs.length, due: batch.counts.due });

  const remaining = free ? Math.max(0, free.questions_remaining - batch.refs.length) : null;
  return json({
    ...publicBatch(batch),
    free_tier: paid || !free ? null : {
      remaining,
      total: FREE_TIER_ITEMS,
      mocks_remaining: Math.max(0, free.mocks_remaining - (kind === "mock" ? 1 : 0)),
      jurisdiction: profile.home_jurisdiction,
    },
    // SPEC §5.2: the client shows the one-person notice until acknowledged.
    sharing_notice_ack: profile.sharing_notice_ack,
  });
});
