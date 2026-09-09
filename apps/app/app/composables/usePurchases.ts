/**
 * In-app purchases via RevenueCat (SPEC §6, §7): one-time products, entitlements `complete` and
 * `pass_guarantee`. RevenueCat's webhook → apps/api `webhook-revenuecat` grants the row in `entitlements`;
 * this composable handles the client side (offerings, purchase, restore) and reports what RC says locally
 * so the UI can unlock immediately while the webhook lands.
 *
 * Product ids must match Play Console / App Store Connect exactly:
 *   complete_lifetime  ($59)   complete_founding ($39, founding price)   pass_guarantee ($20 add-on)
 *
 * State is `useState` so app.vue, pricing and the guarantee offer share one catalog — separate
 * `ref()`s per caller left the Buy button on "Loading store…" after configure had already finished.
 */
import { Capacitor } from "@capacitor/core";
import { Purchases, LOG_LEVEL, type PurchasesPackage, type CustomerInfo } from "@revenuecat/purchases-capacitor";

export const PRODUCT_IDS = { complete: "complete_lifetime", founding: "complete_founding", guarantee: "pass_guarantee" } as const;
export const ENTITLEMENTS = { complete: "complete", guarantee: "pass_guarantee" } as const;

const STORE_TIMEOUT_MS = 10_000;
let configured = false;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function usePurchases() {
  const config = useRuntimeConfig();
  const supported = computed(() => Capacitor.isNativePlatform());
  const packages = useState<PurchasesPackage[]>("purchases.packages", () => []);
  const customer = useState<CustomerInfo | null>("purchases.customer", () => null);
  const busy = useState<boolean>("purchases.busy", () => false);
  const error = useState<string | null>("purchases.error", () => null);
  const ready = useState<boolean>("purchases.ready", () => !Capacitor.isNativePlatform());

  async function configure(appUserId: string | null) {
    if (!supported.value) { ready.value = true; return; }
    const platform = Capacitor.getPlatform();
    const apiKey = platform === "android" ? config.public.revenuecatGoogleKey : config.public.revenuecatAppleKey;
    if (!apiKey) {
      error.value = "purchases not configured for this platform";
      ready.value = true;
      return;
    }
    try {
      await withTimeout((async () => {
        if (!configured) {
          await Purchases.setLogLevel({ level: import.meta.dev ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN });
          await Purchases.configure({ apiKey, appUserID: appUserId ?? undefined });
          configured = true;
        } else if (appUserId) {
          await Purchases.logIn({ appUserID: appUserId }); // ties the RC customer to the Supabase user id → webhook matches
        }
        await refresh();
      })(), STORE_TIMEOUT_MS, "The store is taking too long to respond.");
      error.value = null;
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Could not reach the store.";
    } finally {
      ready.value = true;
    }
  }

  async function refresh() {
    if (!configured) return;
    const [offerings, info] = await Promise.all([Purchases.getOfferings(), Purchases.getCustomerInfo()]);
    packages.value = offerings.current?.availablePackages ?? [];
    customer.value = info.customerInfo;
  }

  const hasComplete = computed(() => !!customer.value?.entitlements.active[ENTITLEMENTS.complete]);
  const hasGuarantee = computed(() => !!customer.value?.entitlements.active[ENTITLEMENTS.guarantee]);

  async function buy(pkg: PurchasesPackage) {
    busy.value = true; error.value = null;
    try { const r = await Purchases.purchasePackage({ aPackage: pkg }); customer.value = r.customerInfo; }
    catch (e: any) { if (!e?.userCancelled) error.value = e?.message ?? String(e); }
    finally { busy.value = false; }
  }

  async function restore() {
    busy.value = true; error.value = null;
    try { const r = await Purchases.restorePurchases(); customer.value = r.customerInfo; }
    catch (e: any) { error.value = e?.message ?? String(e); }
    finally { busy.value = false; }
  }

  return { supported, packages, customer, busy, error, ready, hasComplete, hasGuarantee, configure, refresh, buy, restore };
}
