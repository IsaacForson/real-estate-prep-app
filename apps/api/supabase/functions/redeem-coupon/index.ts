/**
 * POST /functions/v1/redeem-coupon — V2_PLAN §1 coupons.
 *
 * headers: Authorization: Bearer <jwt>, x-device-hash
 * body:    { code }
 * returns: { ok: true, kind, product, value } | { ok: false, error }  (http 200 for a rejected code;
 *          400 for an unparseable one; 429 after 10 attempts an hour — codes are guessable otherwise)
 *
 * gift codes grant the product immediately (entitlement source 'coupon'); percent / amount codes are
 * recorded for the web checkout to apply.
 */
import { audit, authenticate, enforceRateLimit } from "../_shared/auth.ts";
import { normalizeCouponCode } from "../_shared/coupons.ts";
import { rpc } from "../_shared/db.ts";
import { deviceFromRequest } from "../_shared/device.ts";
import { COUPON_ATTEMPTS_PER_HOUR, RATE_WINDOW_SECONDS } from "../_shared/limits.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";

interface RedeemRequest extends Record<string, unknown> {
  code?: unknown;
}

interface RedeemRow {
  ok: boolean;
  kind: string | null;
  product: string | null;
  value: number | string | null;
  error: string | null;
}

serve(async (req) => {
  const ctx = await authenticate(req);
  const body = await readJsonObject<RedeemRequest>(req);
  const code = normalizeCouponCode(body.code);
  if (!code) throw new HttpError(400, "invalid_code", "codes look like XXXX-XXXX-XXXX");

  await enforceRateLimit(ctx.db, `coupon:${ctx.userId}`, COUPON_ATTEMPTS_PER_HOUR, RATE_WINDOW_SECONDS, 1);
  const { deviceHash } = await deviceFromRequest(req, ctx);

  const rows = await rpc<RedeemRow[]>(ctx.db, "fn_redeem_coupon", { p_user_id: ctx.userId, p_code: code });
  const r = rows[0];
  if (!r) throw new HttpError(500, "redeem_failed", "fn_redeem_coupon returned no row");

  await audit(ctx, r.ok ? "coupon.redeemed" : "coupon.rejected", code, {
    error: r.error,
    kind: r.kind,
    device_hash: deviceHash,
  });

  if (!r.ok) return json({ ok: false, error: r.error ?? "invalid_code" });
  return json({
    ok: true,
    kind: r.kind,
    product: r.product,
    value: typeof r.value === "string" ? Number(r.value) : r.value,
    // gift → the client should refresh entitlements now; percent/amount → apply at web checkout
    granted: r.kind === "gift",
  });
});
