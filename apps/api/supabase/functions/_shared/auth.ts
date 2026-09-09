/**
 * Caller identity + SPEC §5.3 session/device checks for the user-facing functions.
 *
 * The client sends three things on every call:
 *   Authorization: Bearer <supabase access token>   (verified by the platform, verify_jwt = true)
 *   x-device-id:  uuid returned by register-device
 *   x-session-id: uuid returned by register-device
 * A request whose session has been revoked (evicted by a newer device, removed from the Devices
 * list, disabled by an admin) gets 401 session_revoked with `reason` and `details` (0022) so the
 * client can say exactly what happened. A stored session stays valid for as long as it is not
 * revoked and its device is still active — a reload never needs to register again.
 */
import { type Db, rpc, serviceClient, sha256Hex, unwrap } from "./db.ts";
import { optionalEnv } from "./env.ts";
import { clientIp, regionFromHeaders } from "./geo.ts";
import { HttpError } from "./response.ts";
import { loadRevocation } from "./session-revoked.ts";
import { maxActiveDevices } from "./settings.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AuthContext {
  db: Db;
  userId: string;
  email: string | null;
  deviceId: string | null;
  sessionId: string | null;
  region: string;
  ipHash: string | null;
}

export async function authenticate(req: Request): Promise<AuthContext> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "missing_token", "authorization bearer token required");

  const db = serviceClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "invalid_token", "session expired or invalid");

  const deviceId = req.headers.get("x-device-id");
  const sessionId = req.headers.get("x-session-id");
  const ip = clientIp(req.headers);
  return {
    db,
    userId: data.user.id,
    email: data.user.email ?? null,
    deviceId: deviceId && UUID_RE.test(deviceId) ? deviceId : null,
    sessionId: sessionId && UUID_RE.test(sessionId) ? sessionId : null,
    region: regionFromHeaders(req.headers),
    ipHash: ip ? await sha256Hex(`${optionalEnv("IP_HASH_SALT", "dev-salt")}:${ip}`) : null,
  };
}

/** Enforce the device/session rule. Also bumps last_seen on session and device. */
export async function requireSession(ctx: AuthContext): Promise<void> {
  if (!ctx.deviceId || !ctx.sessionId) {
    throw new HttpError(
      401,
      "session_required",
      "x-device-id and x-session-id headers required; call register-device first",
    );
  }
  const valid = await rpc<boolean>(ctx.db, "fn_session_is_valid", {
    p_user_id: ctx.userId,
    p_session_id: ctx.sessionId,
    p_device_id: ctx.deviceId,
  });
  if (!valid) {
    const why = await loadRevocation(ctx.db, ctx.userId, ctx.sessionId, await maxActiveDevices(ctx.db));
    throw new HttpError(401, "session_revoked", why.message, { reason: why.reason, details: why.details });
  }
  await rpc<null>(ctx.db, "fn_touch_session", { p_user_id: ctx.userId, p_session_id: ctx.sessionId });
}

export interface Entitlements {
  complete: boolean;
  passGuarantee: boolean;
}

export async function getEntitlements(db: Db, userId: string): Promise<Entitlements> {
  const rows = unwrap(
    await db.from("entitlements").select("product").eq("user_id", userId).is("revoked_at", null),
    "entitlements_lookup",
  ) as { product: string }[];
  return {
    complete: rows.some((r) => r.product === "complete"),
    passGuarantee: rows.some((r) => r.product === "pass_guarantee"),
  };
}

export interface Profile {
  id: string;
  home_jurisdiction: string | null;
  exam_date: string | null;
  sharing_notice_ack: boolean;
  current_session_id: string | null;
}

export async function getProfile(db: Db, userId: string): Promise<Profile> {
  const row = unwrap(
    await db.from("profiles").select("id, home_jurisdiction, exam_date, sharing_notice_ack, current_session_id").eq(
      "id",
      userId,
    ).maybeSingle(),
    "profile_lookup",
  ) as Profile | null;
  if (!row) throw new HttpError(404, "profile_missing", "profile row missing; the auth trigger should have created it");
  return row;
}

/** Record a coarse location observation for the geo heuristic. Never blocks on failure. */
export async function recordGeo(ctx: AuthContext, source: string): Promise<void> {
  const { error } = await ctx.db.from("geo_events").insert({ user_id: ctx.userId, region_key: ctx.region, source });
  if (error) console.warn("geo_events insert failed", error.message);
}

/** Fixed-window rate limit backed by fn_rate_limit_hit. Throws 429 when exceeded. */
export async function enforceRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
  cost = 1,
): Promise<void> {
  const rows = await rpc<{ allowed: boolean; current_count: number; resets_at: string }[]>(db, "fn_rate_limit_hit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
    p_cost: cost,
  });
  const r = rows[0];
  if (r && !r.allowed) {
    throw new HttpError(429, "rate_limited", "slow down: this is above what one person can study in an hour", {
      resets_at: r.resets_at,
      limit,
    });
  }
}

export async function audit(
  ctx: AuthContext,
  action: string,
  target: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await rpc<string>(ctx.db, "fn_audit", {
    p_actor: "user",
    p_user_id: ctx.userId,
    p_action: action,
    p_target: target,
    p_details: details,
    p_ip_hash: ctx.ipHash,
  });
}
