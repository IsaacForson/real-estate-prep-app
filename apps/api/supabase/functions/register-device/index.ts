/**
 * POST /functions/v1/register-device — bind this install to the account and start the account's
 * single live session (SPEC §5.3). Called right after supabase auth sign-in and on app start
 * when the stored session is rejected with 401 session_revoked.
 *
 * headers: Authorization: Bearer <jwt>
 * body:    { fingerprint_hash: sha256 hex, platform: "ios"|"android"|"web", name?: string }
 * returns: { device_id, session_id, created, reason }
 * 409 device_limit carries the active device list so the ui can offer removal.
 */
import { authenticate, enforceRateLimit, recordGeo } from "../_shared/auth.ts";
import { decideRegister, type DeviceSlotRow, FINGERPRINT_RE, isPlatform } from "../_shared/device-rule.ts";
import { rpc, unwrap } from "../_shared/db.ts";
import { DEVICE_REGISTRATIONS_PER_HOUR, MAX_ACTIVE_DEVICES, RATE_WINDOW_SECONDS } from "../_shared/limits.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";

interface RegisterRequest extends Record<string, unknown> {
  fingerprint_hash?: unknown;
  platform?: unknown;
  name?: unknown;
}

interface DeviceListRow extends DeviceSlotRow {
  platform: string;
  name: string | null;
  last_seen: string;
}

serve(async (req) => {
  const ctx = await authenticate(req);
  const body = await readJsonObject<RegisterRequest>(req);
  if (typeof body.fingerprint_hash !== "string" || !FINGERPRINT_RE.test(body.fingerprint_hash)) {
    throw new HttpError(400, "invalid_fingerprint", "fingerprint_hash must be sha256 hex");
  }
  if (!isPlatform(body.platform)) throw new HttpError(400, "invalid_platform");
  const name = body.name === undefined || body.name === null ? null : body.name;
  if (name !== null && (typeof name !== "string" || name.length > 80)) throw new HttpError(400, "invalid_name");

  await enforceRateLimit(ctx.db, `register:${ctx.userId}`, DEVICE_REGISTRATIONS_PER_HOUR, RATE_WINDOW_SECONDS, 1);
  await recordGeo(ctx, "register-device");

  // pre-check with the pure rule so a refusal can explain itself; sql re-checks atomically.
  const devices = unwrap(
    await ctx.db
      .from("devices")
      .select("id, fingerprint_hash, removed_at, cooldown_until, platform, name, last_seen")
      .eq("user_id", ctx.userId),
    "devices_lookup",
  ) as DeviceListRow[];
  const now = new Date();
  const decision = decideRegister(devices, body.fingerprint_hash, now);
  if (!decision.ok) {
    throw new HttpError(
      409,
      "device_limit",
      `this account already has ${MAX_ACTIVE_DEVICES} devices. remove one to sign in here.`,
      {
        occupied: decision.occupied,
        max: MAX_ACTIVE_DEVICES,
        next_slot_frees_at: decision.next_slot_frees_at,
        devices: devices
          .filter((d) => d.removed_at === null)
          .map((d) => ({ id: d.id, platform: d.platform, name: d.name, last_seen: d.last_seen })),
      },
    );
  }

  const rows = await rpc<{ device_id: string; session_id: string; created: boolean }[]>(ctx.db, "fn_register_device", {
    p_user_id: ctx.userId,
    p_fingerprint_hash: body.fingerprint_hash,
    p_platform: body.platform,
    p_name: name,
  });
  const r = rows[0];
  if (!r) throw new HttpError(500, "register_failed", "fn_register_device returned no row");

  return json({
    device_id: r.device_id,
    session_id: r.session_id,
    created: r.created,
    reason: decision.reason,
    // SPEC §5.3: "a second login invalidates the first with a clear message."
    message: "signed in on this device. any other device signed into this account has been signed out.",
  });
});
