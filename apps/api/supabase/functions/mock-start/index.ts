/**
 * POST /functions/v1/mock-start — server-built timed mock (F11; V2_PLAN §3, §6.3).
 *
 * headers: Authorization: Bearer <jwt>, x-device-id, x-session-id, x-device-hash
 * body:    { form_id, jurisdiction, national_bank?: "national_pearsonvue"|"national_psi" }
 * returns: { session: StudySessionRow, batches: IssuedBatch[], free_tier }
 *
 * the session row is the resumable source of truth (status active, item_ids = public ids in order,
 * portions = per-bank batch refs, time_limit_ms). the client fetches each batch's content_url, then
 * answers offline and calls mock-finish once. free tier: home state only, form "short", one mock,
 * counted per account and per device.
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
import { unwrap } from "../_shared/db.ts";
import { bumpFreeTier, deviceFromRequest, freeTierFor } from "../_shared/device.ts";
import { emitEvent } from "../_shared/events.ts";
import { issueBatch, type IssuedBatch, publicBatch } from "../_shared/issue.ts";
import { FREE_TIER_ITEMS, FREE_TIER_MOCK_FORM, MOCK_STARTS_PER_HOUR, RATE_WINDOW_SECONDS } from "../_shared/limits.ts";
import { apportion, FORM_ID_RE, mockFormSpec, NATIONAL_BANKS, type NationalBank } from "../_shared/mock.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";

interface MockStartRequest extends Record<string, unknown> {
  form_id?: unknown;
  jurisdiction?: unknown;
  national_bank?: unknown;
}

const JUR_RE = /^[A-Z]{2}$/;
const MIN_FREE_MOCK_ITEMS = 5;

serve(async (req) => {
  const ctx = await authenticate(req);
  await requireSession(ctx);
  const body = await readJsonObject<MockStartRequest>(req);
  if (typeof body.form_id !== "string" || !FORM_ID_RE.test(body.form_id)) throw new HttpError(400, "invalid_form_id");
  if (typeof body.jurisdiction !== "string" || !JUR_RE.test(body.jurisdiction)) {
    throw new HttpError(400, "invalid_jurisdiction");
  }
  const nationalBank = body.national_bank === undefined ? "national_pearsonvue" : body.national_bank;
  if (typeof nationalBank !== "string" || !(NATIONAL_BANKS as readonly string[]).includes(nationalBank)) {
    throw new HttpError(400, "invalid_national_bank");
  }
  const formId = body.form_id;
  const jurisdiction = body.jurisdiction;

  await recordGeo(ctx, "mock-start");
  const [profile, ent, { deviceHash, touch }] = await Promise.all([
    getProfile(ctx.db, ctx.userId),
    getEntitlements(ctx.db, ctx.userId),
    deviceFromRequest(req, ctx),
  ]);
  const paid = ent.complete;
  const spec = mockFormSpec(formId, jurisdiction, nationalBank as NationalBank);

  // ---- free tier ------------------------------------------------------------------------
  let free: Awaited<ReturnType<typeof freeTierFor>> | null = null;
  let counts = spec.portions.map((p) => p.count);
  if (!paid) {
    const home = profile.home_jurisdiction;
    if (!home) throw new HttpError(403, "home_jurisdiction_required", "choose your state before studying");
    if (jurisdiction !== home) {
      throw new HttpError(
        403,
        "free_tier_one_state",
        `the free tier covers ${home} only. complete unlocks all 51 jurisdictions.`,
      );
    }
    if (formId !== FREE_TIER_MOCK_FORM) {
      throw new HttpError(403, "free_tier_mock_form", `the free tier includes the "${FREE_TIER_MOCK_FORM}" mock only`);
    }
    free = await freeTierFor(ctx.db, ctx.userId, deviceHash, home, touch);
    if (free.reason === "device_blocked" || free.reason === "device_shared") {
      await emitEvent(ctx.db, ctx.userId, deviceHash, "free_tier_blocked", {
        reason: free.reason,
        source: "mock-start",
      });
      throw new HttpError(
        402,
        "free_tier_exhausted",
        "the free tier on this device has been used up. complete is $59 once, forever.",
        {
          reason: free.reason,
        },
      );
    }
    if (free.mocks_remaining === 0) {
      throw new HttpError(402, "free_tier_exhausted", "the free tier includes one mock exam", { reason: "mocks" });
    }
    if (free.questions_remaining < MIN_FREE_MOCK_ITEMS) {
      throw new HttpError(
        402,
        "free_tier_exhausted",
        `you have used the ${FREE_TIER_ITEMS} free questions. complete is $59 once, forever.`,
        {
          reason: "questions",
        },
      );
    }
    // the short mock fits inside the remaining question budget.
    const total = Math.min(spec.size, free.questions_remaining);
    counts = apportion(spec.portions.map((p) => p.count), total);
  }

  await enforceRateLimit(ctx.db, `mocks:${ctx.userId}`, MOCK_STARTS_PER_HOUR, RATE_WINDOW_SECONDS, 1);

  // ---- one batch per portion ------------------------------------------------------------
  const batches: { portion: "national" | "state"; batch: IssuedBatch }[] = [];
  for (let i = 0; i < spec.portions.length; i++) {
    const portion = spec.portions[i]!;
    const size = counts[i] ?? 0;
    if (size <= 0) continue;
    try {
      const batch = await issueBatch(ctx, {
        bank: portion.bank,
        jurisdiction: portion.portion === "national" ? "NAT" : jurisdiction,
        kind: "mock",
        size,
        nodes: null,
        formId,
        paid,
        deviceHash,
      });
      batches.push({ portion: portion.portion, batch });
    } catch (e) {
      // a state bank with no published items yet must not block the national section.
      if (e instanceof HttpError && (e.code === "no_items" || e.code === "content_unavailable")) {
        console.warn(`mock-start: ${portion.bank} has no items (${e.code}); portion skipped`);
        continue;
      }
      throw e;
    }
  }
  if (batches.length === 0) throw new HttpError(404, "no_items", "no published items for this jurisdiction yet");

  // ---- session row (server-owned, resumable) --------------------------------------------
  const itemIds = batches.flatMap((b) => b.batch.public_ids);
  const now = new Date().toISOString();
  const session = unwrap(
    await ctx.db.from("study_sessions").insert({
      id: crypto.randomUUID(),
      user_id: ctx.userId,
      kind: "mock",
      jurisdiction,
      bank: null,
      form_id: formId,
      batch_id: batches[0]!.batch.batch_id,
      started_at: now,
      position: 0,
      answers: [],
      item_ids: itemIds,
      portions: batches.map((b) => ({
        portion: b.portion,
        bank: b.batch.bank,
        batch_id: b.batch.batch_id,
        public_ids: b.batch.public_ids,
        content_url: b.batch.content_url,
        expires_at: b.batch.expires_at,
        signature: b.batch.signature,
        pass_score: spec.pass_score,
      })),
      time_limit_ms: spec.time_limit_ms,
      time_remaining_s: Math.round(spec.time_limit_ms / 1000),
      status: "active",
      device_hash: deviceHash,
      client_updated_at: now,
    }).select("*").single(),
    "study_session_insert",
  ) as { id: string };

  await bumpFreeTier(ctx.db, ctx.userId, deviceHash, jurisdiction, itemIds.length, 1);
  await emitEvent(ctx.db, ctx.userId, deviceHash, "mock_start", {
    session_id: session.id,
    form_id: formId,
    jurisdiction,
    items: itemIds.length,
    portions: batches.map((b) => ({ portion: b.portion, items: b.batch.public_ids.length })),
    server: true,
  });
  await audit(ctx, "mock.started", session.id, { form_id: formId, jurisdiction, items: itemIds.length });

  return json({
    session,
    batches: batches.map((b) => ({ portion: b.portion, ...publicBatch(b.batch) })),
    time_limit_ms: spec.time_limit_ms,
    pass_score: spec.pass_score,
    free_tier: paid || !free ? null : {
      remaining: Math.max(0, free.questions_remaining - itemIds.length),
      total: FREE_TIER_ITEMS,
      mocks_remaining: Math.max(0, free.mocks_remaining - 1),
      jurisdiction: profile.home_jurisdiction,
    },
  });
});
