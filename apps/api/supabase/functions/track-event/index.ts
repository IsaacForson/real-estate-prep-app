/**
 * POST /functions/v1/track-event — batches of learner events (V2_PLAN §3).
 *
 * headers: Authorization: Bearer <jwt> (optional: anonymous pre-sign-in events are allowed),
 *          x-device-hash (required when anonymous; recommended always)
 * body:    { events: { kind, props?, at? }[] }   (≤ 200 per call; unknown kinds are rejected, not stored)
 * returns: { accepted, rejected }
 *
 * verify_jwt = false in config.toml so anonymous calls reach us; a bearer token, when present, is
 * verified here and a bad one is refused (never silently downgraded to anonymous).
 */
import { authenticate, enforceRateLimit } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/db.ts";
import { deviceHashFromHeaders, touchDevice } from "../_shared/device.ts";
import { type EventRow, insertEvents, MAX_EVENTS_PER_CALL, validateEvent } from "../_shared/events.ts";
import { EVENTS_PER_HOUR, RATE_WINDOW_SECONDS } from "../_shared/limits.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";

interface TrackRequest extends Record<string, unknown> {
  events?: unknown;
}

serve(async (req) => {
  const hasBearer = (req.headers.get("authorization") ?? "").startsWith("Bearer ");
  const deviceHash = deviceHashFromHeaders(req.headers);
  let userId: string | null = null;
  let db = serviceClient();
  if (hasBearer) {
    const ctx = await authenticate(req);
    userId = ctx.userId;
    db = ctx.db;
  } else if (!deviceHash) {
    throw new HttpError(401, "device_hash_required", "anonymous events need an x-device-hash header");
  }

  const body = await readJsonObject<TrackRequest>(req);
  if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > MAX_EVENTS_PER_CALL) {
    throw new HttpError(400, "invalid_events", `events must be an array of 1..${MAX_EVENTS_PER_CALL}`);
  }

  await enforceRateLimit(
    db,
    `events:${userId ?? `dev:${deviceHash}`}`,
    EVENTS_PER_HOUR,
    RATE_WINDOW_SECONDS,
    body.events.length,
  );
  await touchDevice(db, deviceHash, userId);

  const now = new Date();
  const rows: EventRow[] = [];
  let rejected = 0;
  for (const e of body.events) {
    const v = validateEvent(e, now);
    if (!v) {
      rejected++;
      continue;
    }
    rows.push({ user_id: userId, device_hash: deviceHash, kind: v.kind, props: v.props, occurred_at: v.at });
  }
  const accepted = await insertEvents(db, rows);
  return json({ accepted, rejected: rejected + (rows.length - accepted), server_time: now.toISOString() });
});
