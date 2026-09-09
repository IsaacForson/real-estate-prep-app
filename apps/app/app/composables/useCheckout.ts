/**
 * Buy Complete or the pass guarantee from wherever the learner is.
 *
 * Native: RevenueCat (Play / App Store). Web: `create-checkout` mints a Paddle or Lemon Squeezy
 * url tied to this account, then we send them there. Public overlay urls in runtime config are a
 * last resort so a hosted buy link can ship without waiting on API keys.
 */
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { callFunction, functionsBase } from "~~/lib/study/api";

export type CheckoutProduct = "complete" | "guarantee";

export function useCheckout() {
  const auth = useAuth();
  const entitlement = useEntitlement();
  const purchases = usePurchases();
  const events = useEvents();
  const config = useRuntimeConfig();
  const busy = ref(false);
  const error = ref<string | null>(null);

  function pkgFor(product: CheckoutProduct): PurchasesPackage | undefined {
    const id = product === "guarantee" ? PRODUCT_IDS.guarantee : (PRODUCT_IDS.founding || PRODUCT_IDS.complete);
    const exact = purchases.packages.value.find((p) => p.product.identifier === id || p.product.identifier.startsWith(`${id}:`));
    if (exact || product === "guarantee") return exact;
    return purchases.packages.value.find((p) =>
      p.product.identifier === PRODUCT_IDS.complete || p.product.identifier.startsWith(`${PRODUCT_IDS.complete}:`)
    ) ?? purchases.packages.value.find((p) =>
      p.product.identifier === PRODUCT_IDS.founding || p.product.identifier.startsWith(`${PRODUCT_IDS.founding}:`)
    );
  }

  function hostedUrl(product: CheckoutProduct): string {
    const raw = product === "guarantee" ? config.public.checkoutGuaranteeUrl : config.public.checkoutCompleteUrl;
    if (typeof raw !== "string" || !raw) return "";
    try {
      const url = new URL(raw);
      const uid = auth.user.value?.id;
      if (uid) url.searchParams.set("checkout[custom][user_id]", uid);
      if (auth.user.value?.email) url.searchParams.set("checkout[email]", auth.user.value.email);
      return url.toString();
    } catch {
      return raw;
    }
  }

  async function buy(product: CheckoutProduct): Promise<boolean> {
    error.value = null;
    if (!auth.signedIn.value) {
      error.value = "Sign in first so the purchase is tied to your account.";
      return false;
    }
    events.track("purchase_started", { product, store: purchases.supported.value ? "store" : "web" });
    busy.value = true;
    try {
      if (purchases.supported.value) {
        const pkg = pkgFor(product);
        if (!pkg) { error.value = "The store catalog has not loaded yet. Try again in a moment."; return false; }
        await purchases.buy(pkg);
        if (purchases.error.value) { error.value = purchases.error.value; events.track("purchase_failed", { product, error: purchases.error.value }); return false; }
      } else {
        const headers = await auth.authHeaders();
        if (!headers) { error.value = "Your session expired. Sign in again."; return false; }
        const apiProduct = product === "guarantee" ? "pass_guarantee" : "complete";
        try {
          const res = await callFunction<{ url?: string }>(
            functionsBase(config.public.supabaseUrl),
            "create-checkout",
            { product: apiProduct },
            headers,
          );
          if (!res.url) throw new Error("no checkout url");
          window.location.assign(res.url);
          return true;
        } catch (e) {
          const fallback = hostedUrl(product);
          if (fallback) { window.location.assign(fallback); return true; }
          error.value = e instanceof Error ? e.message : "Could not start checkout.";
          events.track("purchase_failed", { product, error: error.value });
          return false;
        }
      }

      events.track("purchase_succeeded", { product });
      for (const wait of [1500, 4000, 8000]) {
        await new Promise((r) => setTimeout(r, wait));
        await entitlement.refresh();
        if (product === "guarantee" ? entitlement.hasGuarantee.value : entitlement.isComplete.value) break;
      }
      return true;
    } finally {
      busy.value = false;
    }
  }

  return { buy, busy, error, pkgFor, hostedUrl };
}
