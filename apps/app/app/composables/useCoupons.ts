/**
 * Coupon redemption (V2 §1, §6.3): `redeem-coupon { code }` → `{ ok, product?, kind?, error? }`.
 * Gift / 100 % codes grant `complete` immediately, so the entitlement is refreshed on success.
 */
import type { RedeemCouponResponse } from "~~/lib/state/contracts";
import { ApiError, callFunction, functionsBase } from "~~/lib/study/api";

export function useCoupons() {
  const config = useRuntimeConfig();
  const auth = useAuth();
  const entitlement = useEntitlement();
  const events = useEvents();
  const busy = useState<boolean>("coupons.busy", () => false);

  async function redeem(code: string): Promise<RedeemCouponResponse> {
    const clean = code.trim().toUpperCase();
    if (!clean) return { ok: false, error: "Enter a code." };
    const headers = await auth.authHeaders();
    if (!headers) return { ok: false, error: "Sign in first so the code is applied to your account." };
    busy.value = true;
    try {
      const res = await callFunction<RedeemCouponResponse>(functionsBase(config.public.supabaseUrl), "redeem-coupon", { code: clean }, headers);
      if (res.ok) {
        events.track("coupon_redeemed", { code: clean, product: res.product ?? null, kind: res.kind ?? null });
        await entitlement.refresh();
      }
      return res;
    } catch (e) {
      const msg = e instanceof ApiError ? friendly(e.code, e.message) : e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    } finally {
      busy.value = false;
    }
  }

  return { redeem, busy };
}

function friendly(code: string, fallback: string): string {
  switch (code) {
    case "not_found": case "invalid_code": return "That code doesn't exist. Check it and try again.";
    case "expired": return "That code has expired.";
    case "exhausted": case "max_uses": return "That code has already been used up.";
    case "already_redeemed": return "You've already redeemed this code.";
    default: return fallback || "Couldn't redeem the code.";
  }
}
