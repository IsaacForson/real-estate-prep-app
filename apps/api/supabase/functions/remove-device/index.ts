/**
 * POST /functions/v1/remove-device — sign a device out of the account (SPEC §5.3). Since 0015 there
 * is one active device and the slot frees immediately, so this is only useful for "sign out the
 * device I left somewhere"; signing in on that device again simply takes the slot back.
 *
 * headers: Authorization: Bearer <jwt>  (x-device-id optional, used to tell you signed yourself out)
 * body:    { device_id: uuid }
 * returns: { removed: true, removed_at, signed_out_here }
 */
import { audit, authenticate } from "../_shared/auth.ts";
import { rpc } from "../_shared/db.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RemoveRequest extends Record<string, unknown> {
  device_id?: unknown;
}

serve(async (req) => {
  const ctx = await authenticate(req);
  const body = await readJsonObject<RemoveRequest>(req);
  if (typeof body.device_id !== "string" || !UUID_RE.test(body.device_id)) {
    throw new HttpError(400, "invalid_device_id");
  }

  const removedAt = await rpc<string>(ctx.db, "fn_remove_device", {
    p_user_id: ctx.userId,
    p_device_id: body.device_id,
  });
  const signedOutHere = ctx.deviceId !== null && ctx.deviceId.toLowerCase() === body.device_id.toLowerCase();
  await audit(ctx, "device.remove_requested", body.device_id, { signed_out_here: signedOutHere });

  return json({
    removed: true,
    device_id: body.device_id,
    removed_at: removedAt,
    signed_out_here: signedOutHere,
    message: "device signed out. signing in on it again will move your account back to it.",
  });
});
