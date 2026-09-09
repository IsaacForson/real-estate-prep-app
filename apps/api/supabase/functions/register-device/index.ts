/**
 * POST /functions/v1/register-device — bind this install to the account and start the account's
 * single live session (SPEC §5.3). Called right after supabase auth sign-in and on app start
 * when the stored session is rejected with 401 session_revoked.
 *
 * How many devices an account may hold at once is `app_settings.device_policy.max_active_devices`
 * (0016), which an admin edits from the console. At the default of 1 this call takes the only slot
 * over, retires whatever device held it and revokes its session; above 1 it displaces nothing until
 * the ceiling is reached. It never refuses. Displaced devices see 401 session_revoked.
 *
 * headers: Authorization: Bearer <jwt>, x-device-hash (V2 §1; falls back to fingerprint_hash)
 * body:    { fingerprint_hash: sha256 hex, platform: "ios"|"android"|"web", name?: string, model?: string }
 * returns: { device_id, session_id, created, reason, signed_out, device: { accounts, exhausted, blocked } }
 */
import { authenticate, enforceRateLimit, recordGeo } from "../_shared/auth.ts";
import { decideRegister, type DeviceSlotRow, FINGERPRINT_RE, isPlatform } from "../_shared/device-rule.ts";
import { deviceHashFromHeaders, touchDevice } from "../_shared/device.ts";
import { rpc, unwrap } from "../_shared/db.ts";
import { emitEvent } from "../_shared/events.ts";
import { DEVICE_REGISTRATIONS_PER_HOUR, RATE_WINDOW_SECONDS } from "../_shared/limits.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";
import { maxActiveDevices } from "../_shared/settings.ts";

interface RegisterRequest extends Record<string, unknown> {
  fingerprint_hash?: unknown;
  platform?: unknown;
  name?: unknown;
  model?: unknown;
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
  const model = body.model === undefined || body.model === null ? null : body.model;
  if (model !== null && (typeof model !== "string" || model.length > 120)) throw new HttpError(400, "invalid_model");

  await enforceRateLimit(ctx.db, `register:${ctx.userId}`, DEVICE_REGISTRATIONS_PER_HOUR, RATE_WINDOW_SECONDS, 1);
  await recordGeo(ctx, "register-device");

  // read the current slot holders first so the response can name what this sign-in displaced.
  // sql re-does the same arithmetic atomically under an advisory lock.
  const [devices, ceiling] = await Promise.all([
    Promise.resolve(unwrap(
      await ctx.db
        .from("devices")
        .select("id, fingerprint_hash, removed_at, platform, name, last_seen")
        .eq("user_id", ctx.userId),
      "devices_lookup",
    ) as DeviceListRow[]),
    maxActiveDevices(ctx.db),
  ]);
  const decision = decideRegister(devices, body.fingerprint_hash, ceiling);
  const displaced = decision.superseded.map((s) => {
    const d = devices.find((x) => x.id === s.id)!;
    return { id: d.id, platform: d.platform, name: d.name, last_seen: d.last_seen };
  });

  const rows = await rpc<{ device_id: string; session_id: string; created: boolean; superseded: number }[]>(ctx.db, "fn_register_device", {
    p_user_id: ctx.userId,
    p_fingerprint_hash: body.fingerprint_hash,
    p_platform: body.platform,
    p_name: name,
  });
  const r = rows[0];
  if (!r) throw new HttpError(500, "register_failed", "fn_register_device returned no row");

  // V2 §1 cross-account device tracking. the header wins; the per-account fingerprint is the fallback.
  const deviceHash = deviceHashFromHeaders(req.headers) ?? body.fingerprint_hash;
  const touch = await touchDevice(ctx.db, deviceHash, ctx.userId, { platform: body.platform, model });
  await emitEvent(ctx.db, ctx.userId, deviceHash, "device_registered", {
    device_id: r.device_id,
    platform: body.platform,
    created: r.created,
    superseded: r.superseded,
    accounts_on_device: touch?.account_count ?? null,
  });

  return json({
    device_id: r.device_id,
    session_id: r.session_id,
    created: r.created,
    reason: decision.reason,
    // what this sign-in signed out, so the ui can say "we signed out your laptop".
    signed_out: displaced,
    device: touch
      ? {
        accounts: touch.account_count,
        accounts_30d: touch.accounts_30d,
        exhausted: touch.exhausted,
        blocked: touch.blocked,
      }
      : null,
    max_active_devices: ceiling,
    // SPEC §5.3: "a second login invalidates the first with a clear message."
    message: displaced.length === 0
      ? "signed in on this device."
      : displaced.length === 1
      ? "signed in on this device. your other device has been signed out."
      : `signed in on this device. ${displaced.length} other devices have been signed out.`,
  });
});
