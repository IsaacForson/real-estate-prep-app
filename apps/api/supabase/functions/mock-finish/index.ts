/**
 * POST /functions/v1/mock-finish — score a server-built mock (F11; V2_PLAN §3, §6.3).
 *
 * headers: Authorization: Bearer <jwt>, x-device-id, x-session-id, x-device-hash
 * body:    { session_id, answers: { public_id, choice: "A"|"B"|"C"|"D"|null, ms? }[], time_used_s? }
 * returns: { session_id, score, passed, correct, total, answered, portions, items: [{ public_id, choice, key, correct }] }
 *
 * idempotent: finishing an already-finished session returns the stored result. keys come from the
 * content bucket (never from the client). writes: study_sessions (finished + score), answers rows,
 * progress via the server srs mirror, events (mock_finish).
 */
import { audit, authenticate, recordGeo, requireSession } from "../_shared/auth.ts";
import { rpc, unwrap } from "../_shared/db.ts";
import { deviceFromRequest } from "../_shared/device.ts";
import { emitEvent } from "../_shared/events.ts";
import { contentStore } from "../_shared/issue.ts";
import { type KeyedItem, type MockAnswer, type MockScore, scoreMock, validateMockAnswer } from "../_shared/mock.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";
import { applyAnswer, type SrsState } from "../_shared/srs.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface FinishRequest extends Record<string, unknown> {
  session_id?: unknown;
  answers?: unknown;
  time_used_s?: unknown;
}

interface SessionRow {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  item_ids: string[];
  portions: { portion: "national" | "state"; public_ids: string[]; pass_score?: number }[] | null;
  score: number | null;
  answers: unknown;
  finished_at: string | null;
  form_id: string | null;
  jurisdiction: string;
  time_limit_ms: number | null;
  started_at: string;
}

interface ProgressRow {
  item_id: string;
  attempts: number;
  correct: number;
  streak: number;
  box: "red" | "yellow" | "green";
  due_at: string | null;
  last_answered_at: string | null;
  history: { at: number; correct: boolean }[];
}

serve(async (req) => {
  const ctx = await authenticate(req);
  await requireSession(ctx);
  const body = await readJsonObject<FinishRequest>(req);
  if (typeof body.session_id !== "string" || !UUID_RE.test(body.session_id)) {
    throw new HttpError(400, "invalid_session_id");
  }
  if (!Array.isArray(body.answers) || body.answers.length > 500) throw new HttpError(400, "invalid_answers");
  const answers: MockAnswer[] = [];
  for (const a of body.answers) {
    const v = validateMockAnswer(a);
    if (v) answers.push(v);
  }
  const timeUsed = typeof body.time_used_s === "number" && Number.isInteger(body.time_used_s) && body.time_used_s >= 0
    ? body.time_used_s
    : null;

  await recordGeo(ctx, "mock-finish");
  const { deviceHash } = await deviceFromRequest(req, ctx);

  const session = unwrap(
    await ctx.db.from("study_sessions").select("*").eq("id", body.session_id).eq("user_id", ctx.userId).maybeSingle(),
    "session_lookup",
  ) as SessionRow | null;
  if (!session) throw new HttpError(404, "session_not_found");
  if (session.kind !== "mock") throw new HttpError(400, "not_a_mock");
  if (session.status === "finished") {
    return json({ session_id: session.id, already_finished: true, score: session.score, result: session.answers });
  }
  if (session.item_ids.length === 0) {
    throw new HttpError(409, "session_has_no_items", "this mock was not built by mock-start");
  }

  // ---- keys from the content bucket -----------------------------------------------------
  const resolved = await rpc<{ public_id: string; item_id: string }[]>(ctx.db, "fn_resolve_public_ids", {
    p_user_id: ctx.userId,
    p_public_ids: session.item_ids,
  });
  const store = contentStore(ctx);
  const { items } = await store.loadItems(resolved.map((r) => ({ item_id: r.item_id, public_id: r.public_id })));
  const keyByPublic = new Map(items.map((i) => [i.public_id, i.key]));
  const itemIdByPublic = new Map(resolved.map((r) => [r.public_id, r.item_id]));
  const portionOf = new Map<string, "national" | "state">();
  for (const p of session.portions ?? []) for (const id of p.public_ids ?? []) portionOf.set(id, p.portion);

  const keyed: KeyedItem[] = [];
  let unscorable = 0;
  for (const pid of session.item_ids) {
    const key = keyByPublic.get(pid);
    if (!key) {
      unscorable++;
      continue;
    }
    keyed.push({ public_id: pid, key, portion: portionOf.get(pid) });
  }
  if (keyed.length === 0) {
    throw new HttpError(503, "content_unavailable", "item keys are not available to score this mock");
  }

  const passScore = session.portions?.[0]?.pass_score;
  const result: MockScore = scoreMock(keyed, answers, typeof passScore === "number" ? passScore : undefined);
  const now = new Date();

  // ---- session (service role: the trigger lets the server finalize) ---------------------
  const stored = {
    ...result,
    unscorable,
    finished_at: now.toISOString(),
  };
  unwrap(
    await ctx.db.from("study_sessions").update({
      status: "finished",
      score: result.score,
      finished_at: now.toISOString(),
      ended_at: now.toISOString(),
      position: session.item_ids.length,
      answers: result.items,
      time_used_s: timeUsed,
      time_remaining_s: session.time_limit_ms !== null && timeUsed !== null
        ? Math.max(0, Math.round(session.time_limit_ms / 1000) - timeUsed)
        : null,
      client_updated_at: now.toISOString(),
    }).eq("id", session.id).eq("user_id", ctx.userId),
    "session_finish",
  );

  // ---- answers rows ---------------------------------------------------------------------
  const answerRows = result.items.filter((i) => i.choice !== null).map((i) => ({
    user_id: ctx.userId,
    public_id: i.public_id,
    item_id: itemIdByPublic.get(i.public_id) ?? null,
    session_id: session.id,
    chosen: i.choice,
    correct: i.correct,
    ms: i.ms,
    answered_at: now.toISOString(),
    device_hash: deviceHash,
  }));
  if (answerRows.length) {
    const { error } = await ctx.db.from("answers").upsert(answerRows, { onConflict: "session_id,public_id" });
    if (error) console.warn("answers upsert failed", error.message);
  }

  // ---- progress (server srs mirror; the client may overwrite with a newer client_updated_at) --
  const answeredItemIds = answerRows.map((r) => r.item_id).filter((x): x is string => x !== null);
  if (answeredItemIds.length) {
    const existing = unwrap(
      await ctx.db.from("progress").select("item_id, attempts, correct, streak, box, due_at, last_answered_at, history")
        .eq("user_id", ctx.userId).in(
          "item_id",
          answeredItemIds,
        ),
      "progress_lookup",
    ) as ProgressRow[];
    const prev = new Map(existing.map((p) => [p.item_id, p]));
    const rows = result.items.filter((i) => i.choice !== null).map((i) => {
      const itemId = itemIdByPublic.get(i.public_id);
      const p = itemId ? prev.get(itemId) : undefined;
      const state: SrsState | null = p
        ? {
          attempts: p.attempts,
          correct: p.correct,
          streak: p.streak,
          box: p.box,
          due_at: p.due_at,
          last_answered_at: p.last_answered_at,
          history: p.history ?? [],
        }
        : null;
      const next = applyAnswer(state, i.correct, now.getTime());
      return {
        public_id: i.public_id,
        attempts: next.attempts,
        correct: next.correct,
        last_answered_at: next.last_answered_at,
        box: next.box,
        due_at: next.due_at,
        client_updated_at: now.toISOString(),
        streak: next.streak,
        history: next.history,
      };
    });
    try {
      await rpc(ctx.db, "fn_record_answers", { p_user_id: ctx.userId, p_rows: rows });
    } catch (e) {
      console.warn("fn_record_answers failed after mock", e instanceof Error ? e.message : e);
    }
  }

  await emitEvent(ctx.db, ctx.userId, deviceHash, "mock_finish", {
    session_id: session.id,
    form_id: session.form_id,
    jurisdiction: session.jurisdiction,
    score: result.score,
    passed: result.passed,
    correct: result.correct,
    total: result.total,
    answered: result.answered,
    time_used_s: timeUsed,
    server: true,
  });
  await audit(ctx, "mock.finished", session.id, { score: result.score, total: result.total });

  return json({ session_id: session.id, ...stored });
});
