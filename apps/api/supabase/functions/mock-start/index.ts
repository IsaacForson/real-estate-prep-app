/**
 * POST /functions/v1/mock-start — server-built timed mock (F11; V2_PLAN §3, §6.3).
 *
 * headers: Authorization: Bearer <jwt>, x-device-id, x-session-id, x-device-hash
 * body:    { form_id, jurisdiction, national_bank?: "national_pearsonvue"|"national_psi" }
 * returns: { session: StudySessionRow, batches: IssuedBatch[], title, time_limit_s, time_limit_ms, pass_score,
 *            form: { source: "published"|"fresh", id }, free_tier }
 *
 * the session row is the resumable source of truth (status active, item_ids = public ids in order,
 * portions = per-bank batch refs, time_limit_ms). the client fetches each batch's content_url, then
 * answers offline and calls mock-finish once. free tier: home state only, form "short", one mock,
 * counted per account and per device.
 *
 * forms: a published `mock_forms` row (0021) is used when one exists — the state's own form first,
 * else the vendor's national form (its state portion is then drawn fresh when the state bank has
 * items). only when no row exists is the whole form drawn fresh from the candidates sql.
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
import { itemsAvailable } from "../_shared/availability.ts";
import { emitEvent } from "../_shared/events.ts";
import { issueBatch, issueFixedBatch, type IssuedBatch, publicBatch } from "../_shared/issue.ts";
import { FREE_TIER_ITEMS, FREE_TIER_MOCK_FORM, MOCK_STARTS_PER_HOUR, RATE_WINDOW_SECONDS } from "../_shared/limits.ts";
import {
  apportion,
  FORM_ID_RE,
  type FormPortion,
  formPassScore,
  formPortions,
  type MockFormRow,
  mockFormSpec,
  NATIONAL_BANKS,
  type NationalBank,
  pickFormRow,
  truncatePortions,
} from "../_shared/mock.ts";
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

  // ---- published form? (0021) -------------------------------------------------------------
  const formRows = unwrap(
    await ctx.db.from("mock_forms").select("*").eq("form_id", formId).eq("status", "active")
      .or(`jurisdiction.eq.${jurisdiction},and(jurisdiction.is.null,bank.eq.${nationalBank})`),
    "mock_forms_lookup",
  ) as MockFormRow[] | null;
  const formRow = pickFormRow(formRows ?? [], jurisdiction, nationalBank as NationalBank);
  let fixed: FormPortion[] = formRow ? formPortions(formRow) : [];
  // a national-only form still gets the state portion drawn fresh (skipped when the state bank is empty)
  const freshPortions = formRow && formRow.jurisdiction === null
    ? spec.portions.filter((p) => p.portion === "state")
    : formRow
    ? []
    : spec.portions;
  if (formRow && formRow.jurisdiction === null && freshPortions.length) {
    // a national form paired with a live state bank keeps the exam's national/state split; with an
    // empty state bank the whole national form is used rather than shrinking the mock.
    const stateHasItems = (await Promise.all(freshPortions.map((p) => itemsAvailable(ctx.db, p.bank)))).some((n) => n > 0);
    if (stateHasItems) {
      fixed = fixed.map((p) => {
        const want = spec.portions.find((x) => x.portion === p.portion)?.count ?? p.item_ids.length;
        return { ...p, item_ids: p.item_ids.slice(0, Math.max(1, want)) };
      });
    }
  }
  const timeLimitMs = formRow ? formRow.time_limit_s * 1000 : spec.time_limit_ms;
  const passScore = formRow ? formPassScore(formRow) : spec.pass_score;
  const title = formRow?.title ?? null;

  // ---- free tier ------------------------------------------------------------------------
  let free: Awaited<ReturnType<typeof freeTierFor>> | null = null;
  let counts = freshPortions.map((p) => p.count);
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
    // the short mock fits inside the remaining question budget: the fixed portions first, then
    // whatever is left goes to the fresh ones.
    const fixedSize = fixed.reduce((a, p) => a + p.item_ids.length, 0);
    const total = Math.min(spec.size, free.questions_remaining);
    fixed = truncatePortions(fixed, total);
    const left = Math.max(0, total - Math.min(fixedSize, total));
    counts = apportion(freshPortions.map((p) => p.count), left);
  }

  await enforceRateLimit(ctx.db, `mocks:${ctx.userId}`, MOCK_STARTS_PER_HOUR, RATE_WINDOW_SECONDS, 1);

  // Whatever the banks hold is what the learner sits; only a genuinely empty bank refuses.
  const MIN_MOCK_ITEMS = 1;

  // ---- one batch per portion ------------------------------------------------------------
  const batches: { portion: "national" | "state"; batch: IssuedBatch; pass_score: string | number }[] = [];
  const skipNoItems = (e: unknown, bank: string): boolean => {
    // a state bank with no published items yet must not block the national section.
    if (e instanceof HttpError && (e.code === "no_items" || e.code === "content_unavailable")) {
      console.warn(`mock-start: ${bank} has no items (${e.code}); portion skipped`);
      return true;
    }
    return false;
  };
  for (const portion of fixed) {
    try {
      const batch = await issueFixedBatch(ctx, {
        bank: portion.bank,
        jurisdiction: portion.portion === "national" ? "NAT" : jurisdiction,
        formId,
        deviceHash,
      }, portion.item_ids);
      batches.push({ portion: portion.portion, batch, pass_score: portion.pass_score ?? passScore });
    } catch (e) {
      if (skipNoItems(e, portion.bank)) continue;
      throw e;
    }
  }
  for (let i = 0; i < freshPortions.length; i++) {
    const portion = freshPortions[i]!;
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
      batches.push({ portion: portion.portion, batch, pass_score: passScore });
    } catch (e) {
      if (skipNoItems(e, portion.bank)) continue;
      throw e;
    }
  }
  // A mock is only a mock if it is the real exam's shape. Skipping a portion whose bank is empty,
  // or accepting a batch that came back short, silently produced forms like a 98-question
  // "California" exam (the real one is 150) with the wrong national/state mix and a pass score
  // measured against a length that does not exist — and every one of those left an abandoned
  // session behind that the app then advertised as "Mock in progress".
  // Build the best form the banks can fill rather than refusing outright: a learner would rather
  // sit 113 of 120 questions than nothing, and the client labels the real length instead of calling
  // it "full length". Below a floor it stops being a mock, so that still refuses — and the response
  // carries both numbers so nothing has to guess what it got.
  const wanted = fixed.reduce((a, p) => a + p.item_ids.length, 0) + counts.reduce((a: number, n) => a + (n ?? 0), 0);
  const got = batches.reduce((a, b) => a + b.batch.public_ids.length, 0);
  if (batches.length === 0 || got < MIN_MOCK_ITEMS) {
    throw new HttpError(
      409,
      "bank_short",
      `a mock needs at least ${MIN_MOCK_ITEMS} questions and this jurisdiction's banks can supply ${got} right now`,
      { needed: wanted, available: got, minimum: MIN_MOCK_ITEMS },
    );
  }
  // national before state, whatever order the portions were issued in
  batches.sort((a, b) => (a.portion === b.portion ? 0 : a.portion === "national" ? -1 : 1));

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
        pass_score: b.pass_score,
      })),
      time_limit_ms: timeLimitMs,
      time_remaining_s: Math.round(timeLimitMs / 1000),
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
    published_form: formRow?.id ?? null,
  });
  await audit(ctx, "mock.started", session.id, { form_id: formId, jurisdiction, items: itemIds.length, published_form: formRow?.id ?? null });

  return json({
    session,
    batches: batches.map((b) => ({ portion: b.portion, ...publicBatch(b.batch) })),
    title,
    time_limit_s: Math.round(timeLimitMs / 1000),
    time_limit_ms: timeLimitMs,
    pass_score: passScore,
    form: { source: formRow ? "published" : "fresh", id: formRow?.id ?? null },
    free_tier: paid || !free ? null : {
      remaining: Math.max(0, free.questions_remaining - itemIds.length),
      total: FREE_TIER_ITEMS,
      mocks_remaining: Math.max(0, free.mocks_remaining - 1),
      jurisdiction: profile.home_jurisdiction,
    },
  });
});
