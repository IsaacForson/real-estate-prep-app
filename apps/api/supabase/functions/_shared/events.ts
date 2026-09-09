/**
 * `events` rows (V2_PLAN §2): what a learner did, from the client (track-event) and from the server
 * (issue-batch, mock-start, ...). The admin console renders these as the user timeline, so kinds are a
 * closed list — an unknown kind is rejected rather than stored as noise.
 */
import type { Db } from "./db.ts";

export const CLIENT_EVENT_KINDS = [
  "app_open",
  "sign_in",
  "sign_out",
  "answer",
  "session_start",
  "session_resume",
  "mock_start",
  "mock_finish",
  "purchase_started",
  "purchase_succeeded",
  "purchase_failed",
  "restore",
  "review_submitted",
  "help_search",
  "help_ai_question",
  "ticket_created",
  "coupon_redeemed",
  "settings_changed",
  "content_refreshed",
] as const;

export const SERVER_EVENT_KINDS = [
  "device_seen",
  "device_registered",
  "device_evicted",
  "device_removed",
  "batch_issued",
  "progress_synced",
  "ticket_reply",
  "free_tier_blocked",
] as const;

export type EventKind = (typeof CLIENT_EVENT_KINDS)[number] | (typeof SERVER_EVENT_KINDS)[number];

const ALL_KINDS: ReadonlySet<string> = new Set<string>([...CLIENT_EVENT_KINDS, ...SERVER_EVENT_KINDS]);

export function isEventKind(x: unknown): x is EventKind {
  return typeof x === "string" && ALL_KINDS.has(x);
}

export interface ClientEvent {
  kind: EventKind;
  props: Record<string, unknown>;
  /** when it happened on the device (offline queue); server time is created_at. */
  at: string;
}

export const MAX_EVENT_PROPS_BYTES = 4096;
export const MAX_EVENTS_PER_CALL = 200;

/** Validate one untrusted client event. Only known kinds, object props, plausible timestamp. */
export function validateEvent(x: unknown, now: Date = new Date()): ClientEvent | null {
  if (x === null || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (!isEventKind(r.kind)) return null;
  const props = r.props === undefined || r.props === null ? {} : r.props;
  if (typeof props !== "object" || Array.isArray(props)) return null;
  if (JSON.stringify(props).length > MAX_EVENT_PROPS_BYTES) return null;
  let at = now.toISOString();
  if (r.at !== undefined && r.at !== null) {
    if (typeof r.at !== "string") return null;
    const t = Date.parse(r.at);
    if (!Number.isFinite(t)) return null;
    // clamp: a wildly wrong device clock still lands inside [now - 30d, now + 5min].
    const lo = now.getTime() - 30 * 86_400_000;
    const hi = now.getTime() + 5 * 60_000;
    at = new Date(Math.min(hi, Math.max(lo, t))).toISOString();
  }
  return { kind: r.kind, props: props as Record<string, unknown>, at };
}

export interface EventRow {
  user_id: string | null;
  device_hash: string | null;
  kind: EventKind;
  props: Record<string, unknown>;
  occurred_at: string;
}

/** Insert events; never throws (telemetry must not break the request that emitted it). */
export async function insertEvents(db: Db, rows: EventRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { error } = await db.from("events").insert(rows);
  if (error) {
    console.warn("events insert failed", error.message);
    return 0;
  }
  return rows.length;
}

/** One server-emitted event. */
export function emitEvent(
  db: Db,
  userId: string | null,
  deviceHash: string | null,
  kind: EventKind,
  props: Record<string, unknown> = {},
): Promise<number> {
  return insertEvents(db, [{
    user_id: userId,
    device_hash: deviceHash,
    kind,
    props,
    occurred_at: new Date().toISOString(),
  }]);
}
