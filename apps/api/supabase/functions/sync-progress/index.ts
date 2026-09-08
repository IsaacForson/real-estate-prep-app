/**
 * POST /functions/v1/sync-progress — two-way sync of per-question progress and study sessions
 * (F7 offline-first, F8 never lose progress) plus the SPEC §5.3 anomaly heuristics.
 *
 * headers: Authorization: Bearer <jwt>, x-device-id, x-session-id
 * body: {
 *   progress?:       ProgressRow[]      // keyed by public_id, lww on client_updated_at
 *   study_sessions?: StudySessionRow[]  // keyed by client-generated uuid, lww on client_updated_at
 *   since?:          iso timestamp      // pull server rows updated after this watermark
 * }
 * returns counts per outcome, the server's newer rows, and any anomaly flags opened.
 */
import { answersInWindow, detectAnomalies } from "../_shared/anomaly.ts";
import { audit, authenticate, enforceRateLimit, getEntitlements, recordGeo, requireSession } from "../_shared/auth.ts";
import { rpc, unwrap } from "../_shared/db.ts";
import { drainOutboxForUser } from "../_shared/email.ts";
import { ANOMALY_ANSWERS_PER_HOUR, FREE_TIER_MOCKS, RATE_WINDOW_SECONDS, SYNCS_PER_HOUR } from "../_shared/limits.ts";
import {
  dedupeNewest,
  isIsoDate,
  type ProgressRow,
  type StudySessionRow,
  validateProgressRow,
  validateStudySessionRow,
} from "../_shared/lww.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";

const MAX_PROGRESS_ROWS = 2000;
const MAX_SESSION_ROWS = 50;

interface SyncRequest extends Record<string, unknown> {
  progress?: unknown;
  study_sessions?: unknown;
  since?: unknown;
}

interface RecordResult {
  public_id: string;
  status: "applied" | "skipped_stale" | "unknown_id";
  attempts_delta: number;
  last_answered_at: string | null;
}

serve(async (req) => {
  const ctx = await authenticate(req);
  await requireSession(ctx);
  const body = await readJsonObject<SyncRequest>(req);
  await enforceRateLimit(ctx.db, `syncs:${ctx.userId}`, SYNCS_PER_HOUR, RATE_WINDOW_SECONDS, 1);
  await recordGeo(ctx, "sync-progress");

  const now = new Date();
  const since = isIsoDate(body.since) ? body.since : "1970-01-01T00:00:00Z";

  // ---- progress (lww, per item) ---------------------------------------------------------
  const rawProgress = body.progress === undefined ? [] : body.progress;
  if (!Array.isArray(rawProgress) || rawProgress.length > MAX_PROGRESS_ROWS) {
    throw new HttpError(400, "invalid_progress", `progress must be an array of at most ${MAX_PROGRESS_ROWS} rows`);
  }
  const progressRows: ProgressRow[] = [];
  let invalidProgress = 0;
  for (const r of rawProgress) {
    const v = validateProgressRow(r);
    if (v) progressRows.push(v);
    else invalidProgress++;
  }
  const deduped = dedupeNewest(progressRows, (r) => r.public_id);
  const results = deduped.length
    ? await rpc<RecordResult[]>(ctx.db, "fn_record_answers", { p_user_id: ctx.userId, p_rows: deduped })
    : [];
  const count = (s: RecordResult["status"]) => results.filter((r) => r.status === s).length;

  // ---- study sessions (lww, per session) -----------------------------------------------
  const rawSessions = body.study_sessions === undefined ? [] : body.study_sessions;
  if (!Array.isArray(rawSessions) || rawSessions.length > MAX_SESSION_ROWS) {
    throw new HttpError(
      400,
      "invalid_study_sessions",
      `study_sessions must be an array of at most ${MAX_SESSION_ROWS} rows`,
    );
  }
  const sessionRows: StudySessionRow[] = [];
  const rejected: { id: string | null; reason: string }[] = [];
  for (const r of rawSessions) {
    const v = validateStudySessionRow(r);
    if (v) sessionRows.push(v);
    else {rejected.push({
        id: typeof (r as { id?: unknown })?.id === "string" ? (r as { id: string }).id : null,
        reason: "invalid",
      });}
  }
  let sessionsApplied = 0;
  if (sessionRows.length) {
    const ids = sessionRows.map((s) => s.id);
    const existing = unwrap(
      await ctx.db.from("study_sessions").select("id, user_id, kind, form_id").in("id", ids),
      "study_sessions_lookup",
    ) as { id: string; user_id: string; kind: string; form_id: string | null }[];
    const foreign = new Set(existing.filter((e) => e.user_id !== ctx.userId).map((e) => e.id));

    // free tier: one mock form (SPEC §6). count forms already started plus new ones in this payload.
    const ent = await getEntitlements(ctx.db, ctx.userId);
    let mockForms: Set<string> | null = null;
    if (!ent.complete) {
      const mine = unwrap(
        await ctx.db.from("study_sessions").select("id, form_id").eq("user_id", ctx.userId).eq("kind", "mock"),
        "mock_sessions_lookup",
      ) as { id: string; form_id: string | null }[];
      mockForms = new Set(mine.map((m) => m.form_id ?? m.id));
    }

    const toWrite: Record<string, unknown>[] = [];
    for (const s of dedupeNewest(sessionRows, (r) => r.id)) {
      if (foreign.has(s.id)) {
        rejected.push({ id: s.id, reason: "foreign_id" });
        continue;
      }
      if (mockForms && s.kind === "mock") {
        const key = s.form_id ?? s.id;
        if (!mockForms.has(key)) {
          if (mockForms.size >= FREE_TIER_MOCKS) {
            rejected.push({ id: s.id, reason: "free_tier_mock_limit" });
            continue;
          }
          mockForms.add(key);
        }
      }
      toWrite.push({ ...s, user_id: ctx.userId });
    }
    if (toWrite.length) {
      // the before-write trigger drops stale rows (lww) and pins user_id/created_at.
      unwrap(
        await ctx.db.from("study_sessions").upsert(toWrite, { onConflict: "id" }).select("id"),
        "study_sessions_upsert",
      );
      sessionsApplied = toWrite.length;
    }
  }

  // ---- anomaly heuristics (SPEC §5.3) — observe, flag, email; never block ----------------
  const appliedDelta = results.reduce((n, r) => n + r.attempts_delta, 0);
  const [fingerprints30d, regions24h, velocity] = await Promise.all([
    rpc<number>(ctx.db, "fn_distinct_fingerprints_30d", { p_user_id: ctx.userId }),
    rpc<number>(ctx.db, "fn_distinct_regions_24h", { p_user_id: ctx.userId }),
    // running hourly total of applied answers; the limit here only reports, it never throws.
    rpc<{ allowed: boolean; current_count: number; resets_at: string }[]>(ctx.db, "fn_rate_limit_hit", {
      p_key: `answers:${ctx.userId}`,
      p_limit: ANOMALY_ANSWERS_PER_HOUR,
      p_window_seconds: RATE_WINDOW_SECONDS,
      p_cost: appliedDelta,
    }),
  ]);
  const answersLastHour = Math.max(velocity[0]?.current_count ?? 0, answersInWindow(results, now));
  const findings = detectAnomalies({
    distinctFingerprints30d: fingerprints30d,
    distinctRegions24h: regions24h,
    answersLastHour,
  });
  const opened: string[] = [];
  for (const f of findings) {
    const flagId = await rpc<string | null>(ctx.db, "fn_open_anomaly_flag", {
      p_user_id: ctx.userId,
      p_kind: f.kind,
      p_details: f.details,
    });
    if (flagId) opened.push(f.kind);
  }
  if (opened.length) await drainOutboxForUser(ctx.db, ctx.userId); // stub: logs, leaves rows queued

  // ---- pull: what the server knows that this device might not --------------------------
  const serverProgress = await rpc<unknown[]>(ctx.db, "fn_progress_since", { p_user_id: ctx.userId, p_since: since });
  const serverSessions = unwrap(
    await ctx.db
      .from("study_sessions")
      .select(
        "id, kind, jurisdiction, bank, form_id, batch_id, started_at, ended_at, position, answers, time_remaining_s, client_updated_at, updated_at",
      )
      .eq("user_id", ctx.userId)
      .gt("updated_at", since)
      .order("updated_at", { ascending: true })
      .limit(200),
    "study_sessions_pull",
  ) as unknown[];

  await audit(ctx, "progress.synced", null, {
    applied: count("applied"),
    stale: count("skipped_stale"),
    unknown: count("unknown_id"),
    sessions: sessionsApplied,
  });

  return json({
    server_time: now.toISOString(),
    progress: {
      applied: count("applied"),
      skipped_stale: count("skipped_stale"),
      unknown_id: count("unknown_id"),
      invalid: invalidProgress,
      unknown_ids: results.filter((r) => r.status === "unknown_id").map((r) => r.public_id),
    },
    study_sessions: { applied: sessionsApplied, rejected },
    server: { progress: serverProgress, study_sessions: serverSessions },
    // honest ux: tell the client so it can show "check your email to confirm it's you".
    anomaly_flags_opened: opened,
    reverification_requested: opened.length > 0,
  });
});
