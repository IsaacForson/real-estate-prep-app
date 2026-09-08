/**
 * Pure functions for the two-way sync with apps/api `sync-progress` (F7 offline-first, F8 never
 * lose progress). No I/O here: the composable reads Dexie, calls these, writes Dexie.
 *
 * Wire shapes mirror apps/api/supabase/functions/_shared/lww.ts. Item ids on the wire are the
 * public (per-user aliased) ids — in api mode that is the only id the client has ever seen.
 * Merge rule both ways: strictly newer `client_updated_at` wins; ties keep what we have.
 */
import type { OptionLetter } from "@rep/schema";
import type { Answer, Progress, StudySession, Box } from "./types.js";
import { LEECH_THRESHOLD } from "./srs.js";

export const MAX_PROGRESS_ROWS = 2000;
export const MAX_SESSION_ROWS = 50;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BANK_RE = /^(national_pearsonvue|national_psi|state_[A-Z]{2})$/;
const JUR_RE = /^(NAT|[A-Z]{2})$/;

export interface ServerProgressRow {
  public_id: string;
  attempts: number;
  correct: number;
  last_answered_at: string | null;
  box: Box;
  due_at: string | null;
  client_updated_at: string;
  /** present on rows the server sends back */
  leech?: boolean;
  updated_at?: string;
}

export interface WireAnswer {
  item_id: string;
  choice: OptionLetter;
  correct: boolean;
  at: string;
  elapsed_ms: number;
}

export interface ServerSessionRow {
  id: string;
  kind: "practice" | "mock";
  jurisdiction: string;
  bank: string | null;
  form_id: string | null;
  batch_id: string | null;
  started_at: string;
  ended_at: string | null;
  position: number;
  answers: unknown[];
  time_remaining_s: number | null;
  client_updated_at: string;
  updated_at?: string;
}

export interface SyncPayload {
  progress: ServerProgressRow[];
  study_sessions: ServerSessionRow[];
  since: string | null;
}

export interface SyncResponse {
  server_time: string;
  progress: { applied: number; skipped_stale: number; unknown_id: number; invalid: number; unknown_ids: string[] };
  study_sessions: { applied: number; rejected: Array<{ id: string | null; reason: string }> };
  server: { progress: ServerProgressRow[]; study_sessions: ServerSessionRow[] };
  anomaly_flags_opened: string[];
  reverification_requested: boolean;
}

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

// ---- local → wire -----------------------------------------------------------------------------

export function toServerProgress(p: Progress): ServerProgressRow {
  return {
    public_id: p.itemId,
    attempts: p.attempts,
    correct: Math.min(p.correct, p.attempts),
    last_answered_at: p.lastAnsweredAt == null ? null : iso(p.lastAnsweredAt),
    box: p.box,
    due_at: iso(p.dueAt),
    client_updated_at: iso(p.clientUpdatedAt),
  };
}

export function toWireAnswer(a: Answer): WireAnswer {
  return { item_id: a.itemId, choice: a.choice, correct: a.correct, at: iso(a.at), elapsed_ms: Math.max(0, Math.round(a.elapsedMs)) };
}

/** Jurisdiction the server accepts: the session's own, else derived from its first bank. */
export function wireJurisdiction(s: Pick<StudySession, "jurisdiction" | "banks">): string | null {
  if (JUR_RE.test(s.jurisdiction)) return s.jurisdiction;
  const b = s.banks[0];
  if (!b) return null;
  if (b.startsWith("state_")) return b.slice(6);
  if (b.startsWith("national_")) return "NAT";
  return null;
}

/** Sessions with pre-uuid ids (older local builds) are kept local; drills/reviews sync as practice. */
export function toServerSession(s: StudySession): ServerSessionRow | null {
  if (!UUID_RE.test(s.id)) return null;
  const jurisdiction = wireJurisdiction(s);
  if (!jurisdiction) return null;
  const bank = s.banks[0] && BANK_RE.test(s.banks[0]) ? s.banks[0] : null;
  const answers = Object.values(s.answers).sort((a, b) => a.at - b.at).slice(0, 500).map(toWireAnswer);
  const remaining = s.kind === "mock" && s.timeLimitMs != null
    ? Math.max(0, Math.round((s.startedAt + s.timeLimitMs - s.clientUpdatedAt) / 1000))
    : null;
  return {
    id: s.id,
    kind: s.kind === "mock" ? "mock" : "practice",
    jurisdiction,
    bank,
    form_id: s.mockFormId,
    batch_id: null,
    started_at: iso(s.startedAt),
    ended_at: s.endedAt == null ? null : iso(s.endedAt),
    position: Math.max(0, s.position),
    answers,
    time_remaining_s: remaining,
    client_updated_at: iso(s.clientUpdatedAt),
  };
}

/** Newest row per key (one sync call carries at most one row per id). */
export function dedupeNewest<T extends { client_updated_at: string }>(rows: T[], key: (r: T) => string): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const cur = best.get(key(r));
    if (!cur || ms(r.client_updated_at) > ms(cur.client_updated_at)) best.set(key(r), r);
  }
  return [...best.values()];
}

/**
 * Everything changed locally after `pushedAfter` (ms), oldest first, capped to what one call may
 * carry. `hasMore` tells the caller to sync again right away.
 */
export function buildSyncPayload(o: {
  progress: Progress[];
  sessions: StudySession[];
  pushedAfter: number;
  since: string | null;
}): SyncPayload & { hasMore: boolean } {
  const prog = dedupeNewest(
    o.progress.filter((p) => p.clientUpdatedAt > o.pushedAfter).map(toServerProgress),
    (r) => r.public_id,
  ).sort((a, b) => ms(a.client_updated_at) - ms(b.client_updated_at));
  const sess = dedupeNewest(
    o.sessions.filter((s) => s.clientUpdatedAt > o.pushedAfter).map(toServerSession).filter((r): r is ServerSessionRow => !!r),
    (r) => r.id,
  ).sort((a, b) => ms(a.client_updated_at) - ms(b.client_updated_at));
  return {
    progress: prog.slice(0, MAX_PROGRESS_ROWS),
    study_sessions: sess.slice(0, MAX_SESSION_ROWS),
    since: o.since,
    hasMore: prog.length > MAX_PROGRESS_ROWS || sess.length > MAX_SESSION_ROWS,
  };
}

// ---- wire → local -----------------------------------------------------------------------------

export function isServerNewer(server: { client_updated_at: string }, local: { clientUpdatedAt: number } | undefined): boolean {
  if (!local) return true;
  const t = ms(server.client_updated_at);
  return Number.isFinite(t) && t > local.clientUpdatedAt;
}

/** Minimal streak consistent with a box when the server row carries no streak. */
function streakFor(box: Box): number {
  return box === "red" ? 0 : box === "yellow" ? 1 : 2;
}

export function fromServerProgress(
  row: ServerProgressRow,
  local: Progress | undefined,
  meta: { bank: string; node: string } | undefined,
): Progress {
  const attempts = Math.max(0, row.attempts);
  const correct = Math.min(Math.max(0, row.correct), attempts);
  const misses = attempts - correct;
  const clientUpdatedAt = ms(row.client_updated_at);
  const last = row.last_answered_at ? ms(row.last_answered_at) : null;
  const due = row.due_at ? ms(row.due_at) : clientUpdatedAt;
  return {
    itemId: row.public_id,
    bank: local?.bank ?? meta?.bank ?? "unknown",
    node: local?.node ?? meta?.node ?? "?",
    box: row.box,
    attempts,
    correct,
    // the server keeps no streak/history; keep ours when the row is for an item we know
    streak: local && local.box === row.box ? local.streak : streakFor(row.box),
    misses,
    leech: row.leech ?? misses >= LEECH_THRESHOLD,
    lastAnsweredAt: last != null && Number.isFinite(last) ? last : null,
    dueAt: Number.isFinite(due) ? due : clientUpdatedAt,
    history: local?.history ?? [],
    clientUpdatedAt,
  };
}

/** Rows to write locally: server rows strictly newer than what we hold (or unknown to us). */
export function mergeServerProgress(
  local: Map<string, Progress>,
  server: ServerProgressRow[],
  meta: (publicId: string) => { bank: string; node: string } | undefined = () => undefined,
): Progress[] {
  const out: Progress[] = [];
  for (const row of dedupeNewest(server, (r) => r.public_id)) {
    if (!Number.isFinite(ms(row.client_updated_at))) continue;
    const cur = local.get(row.public_id);
    if (isServerNewer(row, cur)) out.push(fromServerProgress(row, cur, meta(row.public_id)));
  }
  return out;
}

export function fromWireAnswer(x: unknown): Answer | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.item_id !== "string" || typeof r.correct !== "boolean") return null;
  if (r.choice !== "A" && r.choice !== "B" && r.choice !== "C" && r.choice !== "D") return null;
  const at = typeof r.at === "string" ? ms(r.at) : typeof r.at === "number" ? r.at : NaN;
  if (!Number.isFinite(at)) return null;
  return { itemId: r.item_id, choice: r.choice, correct: r.correct, at, elapsedMs: typeof r.elapsed_ms === "number" ? r.elapsed_ms : 0 };
}

/**
 * Apply a server session on top of a local one. The server keeps no item list, so a session we
 * have never seen is rebuilt from its answers (enough for history and SRS; a resume needs the
 * device that started it).
 */
export function fromServerSession(row: ServerSessionRow, local: StudySession | undefined): StudySession {
  const answers: Record<string, Answer> = {};
  for (const a of row.answers) {
    const p = fromWireAnswer(a);
    if (p) answers[p.itemId] = p;
  }
  const answeredIds = Object.values(answers).sort((a, b) => a.at - b.at).map((a) => a.itemId);
  const itemIds = local?.itemIds ?? answeredIds;
  const started = ms(row.started_at);
  return {
    id: row.id,
    kind: local?.kind ?? row.kind,
    jurisdiction: local?.jurisdiction ?? (row.jurisdiction === "NAT" ? "" : row.jurisdiction),
    banks: local?.banks ?? (row.bank ? [row.bank] : []),
    itemIds,
    position: Math.min(Math.max(0, row.position), Math.max(0, itemIds.length - 1)),
    answers: { ...(local?.answers ?? {}), ...answers },
    startedAt: Number.isFinite(started) ? started : local?.startedAt ?? ms(row.client_updated_at),
    endedAt: row.ended_at ? ms(row.ended_at) : null,
    timeLimitMs: local?.timeLimitMs ?? null,
    mockFormId: row.form_id ?? local?.mockFormId ?? null,
    portions: local?.portions,
    clientUpdatedAt: ms(row.client_updated_at),
  };
}

export function mergeServerSessions(local: Map<string, StudySession>, server: ServerSessionRow[]): StudySession[] {
  const out: StudySession[] = [];
  for (const row of dedupeNewest(server, (r) => r.id)) {
    if (!UUID_RE.test(row.id) || !Number.isFinite(ms(row.client_updated_at))) continue;
    const cur = local.get(row.id);
    if (isServerNewer(row, cur)) out.push(fromServerSession(row, cur));
  }
  return out;
}
