/**
 * Last-write-wins merge for progress and study_session rows (F7 offline-first, F8 never lose
 * progress). The database enforces the same rule in a before-update trigger; this module
 * validates and pre-merges the client payload so one sync call carries at most one row per id.
 */

export const BOXES = ["red", "yellow", "green"] as const;
export type Box = (typeof BOXES)[number];

export interface ProgressRow {
  public_id: string;
  attempts: number;
  correct: number;
  last_answered_at: string | null;
  box: Box;
  due_at: string | null;
  client_updated_at: string;
}

export interface StudySessionRow {
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
  // v2 (0012_study_state.sql) — optional so pre-v2 clients keep syncing
  item_ids?: string[];
  portions?: unknown[] | null;
  time_limit_ms?: number | null;
  status?: "active" | "finished" | "abandoned";
  score?: number | null;
  finished_at?: string | null;
  device_hash?: string | null;
  time_used_s?: number | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BANK_RE = /^(national_pearsonvue|national_psi|state_[A-Z]{2})$/;
const JUR_RE = /^(NAT|[A-Z]{2})$/;

export function isIsoDate(x: unknown): x is string {
  return typeof x === "string" && Number.isFinite(Date.parse(x));
}
function isNonNegInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}
function optIso(x: unknown): string | null | undefined {
  if (x === null || x === undefined) return null;
  return isIsoDate(x) ? x : undefined;
}

/** Validate an untrusted progress row. Returns null when it cannot be trusted at all. */
export function validateProgressRow(x: unknown): ProgressRow | null {
  if (x === null || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.public_id !== "string" || r.public_id.length === 0 || r.public_id.length > 64) return null;
  if (!isNonNegInt(r.attempts) || !isNonNegInt(r.correct) || r.correct > r.attempts) return null;
  if (!isIsoDate(r.client_updated_at)) return null;
  if (typeof r.box !== "string" || !(BOXES as readonly string[]).includes(r.box)) return null;
  const last = optIso(r.last_answered_at);
  const due = optIso(r.due_at);
  if (last === undefined || due === undefined) return null;
  return {
    public_id: r.public_id,
    attempts: r.attempts,
    correct: r.correct,
    last_answered_at: last,
    box: r.box as Box,
    due_at: due,
    client_updated_at: r.client_updated_at,
  };
}

export function validateStudySessionRow(x: unknown): StudySessionRow | null {
  if (x === null || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== "string" || !UUID_RE.test(r.id)) return null;
  if (r.kind !== "practice" && r.kind !== "mock") return null;
  if (typeof r.jurisdiction !== "string" || !JUR_RE.test(r.jurisdiction)) return null;
  if (r.bank !== null && r.bank !== undefined && (typeof r.bank !== "string" || !BANK_RE.test(r.bank))) return null;
  if (r.form_id !== null && r.form_id !== undefined && typeof r.form_id !== "string") return null;
  if (
    r.batch_id !== null && r.batch_id !== undefined && (typeof r.batch_id !== "string" || !UUID_RE.test(r.batch_id))
  ) return null;
  if (!isIsoDate(r.started_at) || !isIsoDate(r.client_updated_at)) return null;
  const ended = optIso(r.ended_at);
  if (ended === undefined) return null;
  if (!isNonNegInt(r.position)) return null;
  if (!Array.isArray(r.answers) || r.answers.length > 500) return null;
  if (r.time_remaining_s !== null && r.time_remaining_s !== undefined && !isNonNegInt(r.time_remaining_s)) return null;
  // v2 columns (all optional)
  const extra: Partial<StudySessionRow> = {};
  if (r.item_ids !== undefined) {
    if (
      !Array.isArray(r.item_ids) || r.item_ids.length > 300 ||
      !r.item_ids.every((x) => typeof x === "string" && x.length <= 64)
    ) return null;
    extra.item_ids = r.item_ids as string[];
  }
  if (r.portions !== undefined && r.portions !== null) {
    if (!Array.isArray(r.portions) || r.portions.length > 10) return null;
    extra.portions = r.portions;
  }
  if (r.time_limit_ms !== undefined && r.time_limit_ms !== null) {
    if (!isNonNegInt(r.time_limit_ms) || r.time_limit_ms === 0) return null;
    extra.time_limit_ms = r.time_limit_ms;
  }
  if (r.status !== undefined) {
    if (r.status !== "active" && r.status !== "finished" && r.status !== "abandoned") return null;
    extra.status = r.status;
  }
  if (r.score !== undefined && r.score !== null) {
    if (typeof r.score !== "number" || !Number.isFinite(r.score) || r.score < 0 || r.score > 1) return null;
    extra.score = r.score;
  }
  if (r.finished_at !== undefined && r.finished_at !== null) {
    if (!isIsoDate(r.finished_at)) return null;
    extra.finished_at = r.finished_at;
  }
  if (r.device_hash !== undefined && r.device_hash !== null) {
    if (typeof r.device_hash !== "string" || !/^[0-9a-f]{64}$/.test(r.device_hash)) return null;
    extra.device_hash = r.device_hash;
  }
  if (r.time_used_s !== undefined && r.time_used_s !== null) {
    if (!isNonNegInt(r.time_used_s)) return null;
    extra.time_used_s = r.time_used_s;
  }
  return {
    ...extra,
    id: r.id,
    kind: r.kind,
    jurisdiction: r.jurisdiction,
    bank: (r.bank as string | undefined) ?? null,
    form_id: (r.form_id as string | undefined) ?? null,
    batch_id: (r.batch_id as string | undefined) ?? null,
    started_at: r.started_at,
    ended_at: ended,
    position: r.position,
    answers: r.answers,
    time_remaining_s: (r.time_remaining_s as number | undefined) ?? null,
    client_updated_at: r.client_updated_at,
  };
}

/** Strictly newer wins; equal timestamps keep the existing (server) row. */
export function isNewer(incoming: { client_updated_at: string }, existing: { client_updated_at: string }): boolean {
  return Date.parse(incoming.client_updated_at) > Date.parse(existing.client_updated_at);
}

/** Collapse duplicates in one payload, keeping the newest row per key. */
export function dedupeNewest<T extends { client_updated_at: string }>(rows: T[], key: (r: T) => string): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const k = key(r);
    const cur = best.get(k);
    if (!cur || isNewer(r, cur)) best.set(k, r);
  }
  return [...best.values()];
}

export interface MergeResult<T> {
  winners: T[]; // rows to write
  stale: T[]; // rows the server already has newer state for
}

/** Pure lww merge of incoming rows against what the server currently holds. */
export function mergeLww<T extends { client_updated_at: string }>(
  existing: T[],
  incoming: T[],
  key: (r: T) => string,
): MergeResult<T> {
  const have = new Map(existing.map((r) => [key(r), r] as const));
  const winners: T[] = [];
  const stale: T[] = [];
  for (const r of dedupeNewest(incoming, key)) {
    const cur = have.get(key(r));
    if (!cur || isNewer(r, cur)) winners.push(r);
    else stale.push(r);
  }
  return { winners, stale };
}
