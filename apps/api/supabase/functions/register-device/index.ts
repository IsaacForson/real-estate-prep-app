/**
 * POST /functions/v1/register-device — bind this install to the account and start (or resume) its
 * session (SPEC §5.3). Called right after supabase auth sign-in, when the stored session is rejected
 * with 401 session_required, and once when a stored device's fingerprint changed (adopt).
 *
 * How many devices an account may hold at once is `app_settings.device_policy.max_active_devices`
 * (0016; default 2 since 0022), which an admin edits from the console. A device that already holds a
 * slot is refreshed in place and its live session is reused — nothing else moves. A device that does
 * not hold a slot takes one and, if the account is over the ceiling, the least recently seen device is
 * evicted: its session is revoked with reason new_device and it learns who did it on its next call.
 * Registration is never refused.
 *
 * headers: Authorization: Bearer <jwt>, x-device-hash (V2 §1; falls back to fingerprint_hash)
 * body:    { fingerprint_hash: sha256 hex, platform: "ios"|"android"|"web", name?: string, model?: string,
 *            device_id?: uuid   // adopt: keep this device row, move the fingerprint onto it }
 * returns: { device_id, session_id, created, session_reused, adopted, reason, signed_out[], evicted[],
 *            device: { accounts, exhausted, blocked }, max_active_devices, message }
 */
import { authenticate, enforceRateLimit, recordGeo } from "../_shared/auth.ts";
import { decideRegister, type DeviceSlotRow, FINGERPRINT_RE, isPlatform } from "../_shared/device-rule.ts";
import { deviceHashFromHeaders, touchDevice } from "../_shared/device.ts";
import { rpc, unwrap } from "../_shared/db.ts";
import { emitEvent } from "../_shared/events.ts";
import { DEVICE_REGISTRATIONS_PER_HOUR, RATE_WINDOW_SECONDS } from "../_shared/limits.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";
import { maxActiveDevices } from "../_shared/settings.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RegisterRequest extends Record<string, unknown> {
  fingerprint_hash?: unknown;
  platform?: unknown;
  name?: unknown;
  model?: unknown;
  device_id?: unknown;
}

interface DeviceListRow extends DeviceSlotRow {
  platform: string;
  name: string | null;
  last_seen: string;
  first_seen: string;
  is_shadow?: boolean | null;
}

interface RegisterRow {
  device_id: string;
  session_id: string;
  created: boolean;
  superseded: number;
  evicted: string[] | null;
  session_reused: boolean;
  adopted: boolean;
}

/** Describe one displaced device for the client; falls back to the id when the row is unknown. */
function describe(devices: DeviceListRow[], id: string) {
  const d = devices.find((x) => x.id === id);
  return d
    ? { id: d.id, platform: d.platform, name: d.name, last_seen: d.last_seen }
    : { id, platform: null, name: null, last_seen: null };
}

function label(d: { name: string | null; platform: string | null }): string {
  return d.name ?? (d.platform === "web" ? "your other computer" : "your other device");
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
  const adoptId = body.device_id === undefined || body.device_id === null ? null : body.device_id;
  if (adoptId !== null && (typeof adoptId !== "string" || !UUID_RE.test(adoptId))) {
    throw new HttpError(400, "invalid_device_id");
  }

  await enforceRateLimit(ctx.db, `register:${ctx.userId}`, DEVICE_REGISTRATIONS_PER_HOUR, RATE_WINDOW_SECONDS, 1);
  await recordGeo(ctx, "register-device");

  // read the slot holders first so the response can name what this sign-in displaces (name, platform).
  // sql re-does the arithmetic atomically under an advisory lock and is the authority on *what* moved.
  const [devices, ceiling] = await Promise.all([
    Promise.resolve(unwrap(
      await ctx.db
        .from("devices")
        .select("id, fingerprint_hash, removed_at, platform, name, last_seen, first_seen, is_shadow")
        .eq("user_id", ctx.userId),
      "devices_lookup",
    ) as DeviceListRow[]),
    maxActiveDevices(ctx.db),
  ]);
  const decision = decideRegister(devices.filter((d) => !d.is_shadow), body.fingerprint_hash, ceiling);

  const rows = await rpc<RegisterRow[]>(ctx.db, "fn_register_device", {
    p_user_id: ctx.userId,
    p_fingerprint_hash: body.fingerprint_hash,
    p_platform: body.platform,
    p_name: name,
    p_adopt_device_id: adoptId,
  });
  const r = rows[0];
  if (!r) throw new HttpError(500, "register_failed", "fn_register_device returned no row");

  const evictedIds = r.evicted ?? [];
  const evicted = evictedIds.map((id) => describe(devices, id));

  // V2 §1 cross-account device tracking. the header wins; the per-account fingerprint is the fallback.
  const deviceHash = deviceHashFromHeaders(req.headers) ?? body.fingerprint_hash;
  const touch = await touchDevice(ctx.db, deviceHash, ctx.userId, { platform: body.platform, model });

  // a same-device resume is not a registration: no event, otherwise every reload is a row of noise.
  if (!r.session_reused || r.created || r.adopted) {
    await emitEvent(ctx.db, ctx.userId, deviceHash, "device_registered", {
      device_id: r.device_id,
      platform: body.platform,
      created: r.created,
      reason: decision.reason,
      session_reused: r.session_reused,
      adopted: r.adopted,
      evicted: evictedIds.length,
      max_active_devices: ceiling,
      accounts_on_device: touch?.account_count ?? null,
    });
  }
  for (const id of evictedIds) {
    await emitEvent(ctx.db, ctx.userId, deviceHash, "device_evicted", {
      evicted_device_id: id,
      by_device_id: r.device_id,
      max_active_devices: ceiling,
    });
  }

  const plural = ceiling === 1 ? "one device was" : `${ceiling} devices were`;
  return json({
    device_id: r.device_id,
    session_id: r.session_id,
    created: r.created,
    session_reused: r.session_reused,
    adopted: r.adopted,
    reason: decision.reason,
    // what this sign-in signed out, so the ui can say "we signed out your laptop".
    signed_out: evicted,
    evicted,
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
    message: evicted.length === 0
      ? "Signed in."
      : evicted.length === 1
      ? `Signed in. ${label(evicted[0]!)} was signed out because ${plural} already active.`
      : `Signed in. ${evicted.length} other devices were signed out because ${plural} already active.`,
  });
});
