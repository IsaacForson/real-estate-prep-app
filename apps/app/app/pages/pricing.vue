<script setup lang="ts">
/**
 * Pricing (SPEC §6): one-time Complete ($59, founding $39) + Pass guarantee add-on ($20).
 * Native (Capacitor): RevenueCat packages from the current offering; the customer is logged into
 * RevenueCat as the Supabase uid so the webhook can grant the `entitlements` row. Web: merchant of
 * record checkout is not live yet, so the page explains and points at the app.
 */
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";

useHead({ title: "Pricing — $59 once, every state, forever" });
const auth = useAuth();
const mode = useAppMode();
const entitlement = useEntitlement();
const purchases = usePurchases();

const notice = ref<string | null>(null);
const justBought = ref(false);

function pkgFor(productId: string): PurchasesPackage | undefined {
  return purchases.packages.value.find((p) => p.product.identifier === productId || p.product.identifier.startsWith(`${productId}:`));
}
/** Founding price while it lasts, otherwise the standard product. Play/App Store decide availability. */
const completePkg = computed(() => pkgFor(PRODUCT_IDS.founding) ?? pkgFor(PRODUCT_IDS.complete));
const isFoundingPrice = computed(() => !!completePkg.value && completePkg.value.product.identifier.startsWith(PRODUCT_IDS.founding));
const guaranteePkg = computed(() => pkgFor(PRODUCT_IDS.guarantee));
const owned = computed(() => entitlement.isComplete.value || purchases.hasComplete.value);
const ownedGuarantee = computed(() => entitlement.hasGuarantee.value || purchases.hasGuarantee.value);

async function setup() {
  if (!purchases.supported.value) return;
  await purchases.configure(auth.user.value?.id ?? null);
}
async function buy(pkg: PurchasesPackage | undefined) {
  notice.value = null;
  if (!pkg) return;
  if (!auth.signedIn.value) {
    notice.value = "Sign in first (it takes one email code) so the purchase is tied to your account and restores on your other devices.";
    return;
  }
  await purchases.buy(pkg);
  if (purchases.error.value) return;
  if (purchases.hasComplete.value || purchases.hasGuarantee.value) {
    justBought.value = true;
    // the webhook grants the server-side row within a few seconds; poll a couple of times.
    for (const wait of [1500, 4000, 8000]) {
      await new Promise((r) => setTimeout(r, wait));
      await entitlement.refresh();
      if (entitlement.isComplete.value) break;
    }
  }
}
async function restore() {
  notice.value = null;
  await purchases.restore();
  await entitlement.refresh();
  if (!purchases.error.value) notice.value = purchases.hasComplete.value ? "Purchases restored." : "No previous purchases found for this store account.";
}

onMounted(() => { void setup(); void entitlement.load(); });
watch(() => auth.user.value?.id, (id) => { if (id && purchases.supported.value) void purchases.configure(id); });
</script>
<template>
  <div>
    <h1>One payment. Everything. Forever.</h1>
    <p class="muted">The use window for exam prep is four to six weeks. A subscription in a four-week product is a trap, and the reviews of every other app say so. We don't run one.</p>

    <p v-if="owned" class="notice">You have <strong>Complete</strong>. Every state, both national banks, all mocks and audio are unlocked on this account<template v-if="ownedGuarantee"> with the pass guarantee</template>.</p>

    <div class="grid">
      <div class="card">
        <h2>Free</h2>
        <div style="font-size:28px;font-weight:700">$0</div>
        <ul>
          <li>40 questions in one state, with full explanations and statute citations</li>
          <li>One short mock</li>
          <li>No card, no trial that converts behind your back</li>
        </ul>
      </div>
      <div class="card" style="border-color: var(--accent)">
        <h2>Complete</h2>
        <div style="font-size:28px;font-weight:700">
          <template v-if="completePkg">
            {{ completePkg.product.priceString }}
            <span class="muted" style="font-size:14px"> one time<template v-if="isFoundingPrice"> · founding price, regular $59</template></span>
          </template>
          <template v-else>$59 <span class="muted" style="font-size:14px">one time · founding price $39 until 25 states are complete</span></template>
        </div>
        <ul>
          <li>All 50 states + DC state portions — including states still in production, which arrive as they pass verification</li>
          <li>Both national banks, routed to your state's exam vendor</li>
          <li>Every question, every explanation, every citation, every mock. No daily limits. No upsells.</li>
          <li>Audio narration, offline study, spaced repetition, readiness score, coverage meter</li>
          <li>All future content and statute updates</li>
        </ul>
        <template v-if="purchases.supported.value">
          <button v-if="!owned" class="primary" :disabled="purchases.busy.value || !completePkg" @click="buy(completePkg)">
            {{ purchases.busy.value ? "Working…" : completePkg ? `Get Complete · ${completePkg.product.priceString}` : "Loading store…" }}
          </button>
          <p v-else-if="justBought" class="notice">Thank you. Unlocked on this device now; syncing to your account.</p>
        </template>
      </div>
      <div class="card">
        <h2>Pass guarantee</h2>
        <div style="font-size:28px;font-weight:700">+{{ guaranteePkg?.product.priceString ?? "$20" }}</div>
        <ul>
          <li>Full refund of both payments on proof of a failed attempt within 90 days of purchase</li>
          <li>Requires having completed at least 5 full-length mocks — so the guarantee also pushes you to do the thing that predicts passing</li>
        </ul>
        <template v-if="purchases.supported.value">
          <button v-if="!ownedGuarantee" :disabled="purchases.busy.value || !guaranteePkg || !owned" @click="buy(guaranteePkg)">
            {{ owned ? "Add the guarantee" : "Requires Complete" }}
          </button>
          <p v-else class="muted">Guarantee active.</p>
        </template>
      </div>
    </div>

    <template v-if="purchases.supported.value">
      <p v-if="notice" class="notice">{{ notice }} <NuxtLink v-if="!auth.signedIn.value" to="/account">Sign in</NuxtLink></p>
      <p v-if="purchases.error.value" class="muted" style="color:var(--red)">{{ purchases.error.value }}</p>
      <p class="muted">Bought before? <button :disabled="purchases.busy.value" @click="restore">Restore purchases</button></p>
    </template>
    <p v-else class="notice">
      <template v-if="mode === 'static'">This build runs without accounts; purchases are available in the Android app.</template>
      <template v-else>Web checkout opens soon. Today, buy in the Android app: sign in there with the same email and Complete unlocks here too.</template>
      Purchases are not shareable across accounts: your readiness score and schedule are computed from one person's answers, so a shared account degrades for everyone using it.
    </p>
    <p class="muted"><NuxtLink to="/legal/disclaimer">Trademark and affiliation disclaimer</NuxtLink></p>
  </div>
</template>
