<script setup lang="ts">
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { pushToast } from "~/components/Toast.vue";
/**
 * Pricing: Free · Complete ($59 once) · Pass guarantee (+$20). Native: RevenueCat store prices and
 * purchase buttons. Web: checkout status explained. Nothing here depends on admin status; "Requires
 * Complete" appears only once auth is ready and the account truly lacks it.
 */
useHead({ title: "Pricing — $59 once, every state, forever" });
const auth = useAuth();
const entitlement = useEntitlement();
const purchases = usePurchases();
const events = useEvents();
const notice = ref<string | null>(null);
const justBought = ref(false);

function pkgFor(id: string): PurchasesPackage | undefined { return purchases.packages.value.find((p) => p.product.identifier === id || p.product.identifier.startsWith(`${id}:`)); }
const completePkg = computed(() => pkgFor(PRODUCT_IDS.founding) ?? pkgFor(PRODUCT_IDS.complete));
const isFounding = computed(() => !!completePkg.value && completePkg.value.product.identifier.startsWith(PRODUCT_IDS.founding));
const guaranteePkg = computed(() => pkgFor(PRODUCT_IDS.guarantee));
const ready = computed(() => auth.ready.value);
const owned = computed(() => entitlement.isComplete.value || purchases.hasComplete.value);
const ownedGuarantee = computed(() => entitlement.hasGuarantee.value || purchases.hasGuarantee.value);
const native = computed(() => purchases.supported.value);
const completePrice = computed(() => completePkg.value?.product.priceString ?? "$59");
const guaranteePrice = computed(() => guaranteePkg.value?.product.priceString ?? "$20");

async function buy(pkg: PurchasesPackage | undefined, product: "complete" | "guarantee") {
  notice.value = null;
  if (!pkg) return;
  if (!auth.signedIn.value) { notice.value = "Sign in first (one email code) so the purchase is tied to your account and restores on your other devices."; return; }
  events.track("purchase_started", { product, store: purchases.supported.value ? "store" : "web" });
  await purchases.buy(pkg);
  if (purchases.error.value) { events.track("purchase_failed", { product, error: purchases.error.value }); return; }
  if (purchases.hasComplete.value || purchases.hasGuarantee.value) {
    justBought.value = true;
    events.track("purchase_succeeded", { product });
    for (const wait of [1500, 4000, 8000]) { await new Promise((r) => setTimeout(r, wait)); await entitlement.refresh(); if (entitlement.isComplete.value) break; }
    pushToast("Thank you. Everything is unlocked.", "ok");
  }
}
async function restore() {
  notice.value = null;
  await purchases.restore();
  await entitlement.refresh();
  events.track("restore", { found: purchases.hasComplete.value });
  if (!purchases.error.value) pushToast(purchases.hasComplete.value ? "Purchases restored." : "No previous purchases found for this store account.", purchases.hasComplete.value ? "ok" : "info");
}
onMounted(async () => { if (native.value) await purchases.configure(auth.user.value?.id ?? null); void entitlement.load(); });
watch(() => auth.user.value?.id, (id) => { if (id && native.value) void purchases.configure(id); });

const completeFeatures = [
  "All 50 states + DC state portions — states still in production arrive as they pass verification",
  "Both national banks, routed to your state's exam vendor",
  "Every question, explanation, citation and mock. No daily limits. No upsells.",
  "Audio narration, offline study, spaced repetition, readiness score, coverage meter",
  "All future content and statute updates",
];
</script>
<template>
  <div class="safe-px anim-fade-up mx-auto grid max-w-5xl gap-9 py-8 md:py-16">
    <header class="mx-auto grid max-w-2xl gap-3.5 text-center">
      <p class="eyebrow">Pricing</p>
      <h1 class="display text-[34px] md:text-[52px]">One payment. Everything. Forever.</h1>
      <p class="text-[15px] leading-relaxed text-ink-2 md:text-[17px]">
        The study window for this exam is four to six weeks. A subscription in a four-week product is
        a trap, and the reviews of every other app say so. We don't run one.
      </p>
    </header>

    <AppCard v-if="ready && owned" tone="accent">
      <div class="flex items-center gap-3.5">
        <span class="grid size-10 shrink-0 place-items-center rounded-card bg-accent text-accent-ink">
          <Icon name="check" :size="21" :stroke-width="2.4" />
        </span>
        <p class="text-[14px] leading-relaxed md:text-[15px]">
          You have <strong class="font-semibold">Complete</strong>. Every state, both national banks,
          all mocks and audio are unlocked on this account<template v-if="ownedGuarantee"> with the pass guarantee</template>.
        </p>
      </div>
    </AppCard>

    <!-- Complete is the offer, so it is the only card with a shadow and a ribbon. The other two are
         deliberately quiet: comparison, not competition. -->
    <div class="grid gap-4 md:grid-cols-3 md:items-start">
      <AppCard padding="lg">
        <p class="eyebrow">Free</p>
        <p class="display mt-2.5 text-[38px]">$0</p>
        <ul class="mt-5 grid gap-3 text-[13.5px] leading-relaxed text-ink-2">
          <li class="flex gap-2.5"><Icon name="check" :size="16" class="mt-0.5 shrink-0 text-ok" />40 questions in one state, with full explanations and statute citations</li>
          <li class="flex gap-2.5"><Icon name="check" :size="16" class="mt-0.5 shrink-0 text-ok" />One short mock</li>
          <li class="flex gap-2.5"><Icon name="check" :size="16" class="mt-0.5 shrink-0 text-ok" />No card, no trial that converts behind your back</li>
        </ul>
        <AppButton v-if="!auth.signedIn.value" to="/signin" variant="secondary" size="lg" block class="mt-6">Start free</AppButton>
      </AppCard>

      <!-- The ribbon sits inside the card's flow, not absolutely above it: AppCard clips overflow so
           it can carry `padding="none"` list rows. -->
      <AppCard padding="lg" class="border-line-strong shadow-float md:-mt-3">
        <div class="flex items-center justify-between gap-2">
          <p class="eyebrow">Complete</p>
          <span class="rounded-pill bg-action px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-action-ink">
            Everything
          </span>
        </div>
        <p class="mt-2.5 flex flex-wrap items-baseline gap-2">
          <span class="display text-[38px]">{{ completePrice }}</span>
          <span class="text-[13px] text-muted">
            one time<template v-if="isFounding"> · founding price, regular $59</template><template v-else-if="!completePkg"> · founding price $39 until 25 states are complete</template>
          </span>
        </p>
        <ul class="mt-5 grid gap-3 text-[13.5px] leading-relaxed text-ink-2">
          <li v-for="f in completeFeatures" :key="f" class="flex gap-2.5">
            <Icon name="check" :size="16" class="mt-0.5 shrink-0 text-ok" />{{ f }}
          </li>
        </ul>
        <div class="mt-6 grid gap-2">
          <template v-if="native">
            <AppButton v-if="!ready" variant="primary" size="lg" block loading>Checking your account…</AppButton>
            <AppButton
              v-else-if="!owned"
              variant="primary"
              size="lg"
              block
              :loading="purchases.busy.value"
              :disabled="!completePkg"
              @click="buy(completePkg, 'complete')"
            >{{ completePkg ? `Get Complete · ${completePrice}` : 'Loading store…' }}</AppButton>
            <p v-else-if="justBought" class="text-center text-[13.5px] font-medium text-ok">Unlocked. Syncing to your account…</p>
          </template>
          <template v-else>
            <AppButton v-if="!auth.signedIn.value" to="/signin" variant="primary" size="lg" block>Start free, then upgrade</AppButton>
            <div v-else-if="ready && !owned" class="rounded-card border border-line bg-paper p-3.5 text-[13px] leading-relaxed text-ink-2">
              <strong class="font-semibold text-ink">Web checkout is opening soon.</strong>
              Today, buy in the Android app: sign in there with the same email and Complete unlocks
              here too. Have a gift code? Redeem it from
              <NuxtLink to="/app/account" class="font-medium text-accent hover:underline hover:underline-offset-4">Account</NuxtLink>.
            </div>
          </template>
        </div>
      </AppCard>

      <AppCard padding="lg">
        <p class="eyebrow">Pass guarantee</p>
        <p class="mt-2.5 flex items-baseline gap-2">
          <span class="display text-[38px]">+{{ guaranteePrice }}</span>
          <span class="text-[13px] text-muted">add-on</span>
        </p>
        <ul class="mt-5 grid gap-3 text-[13.5px] leading-relaxed text-ink-2">
          <li class="flex gap-2.5"><Icon name="check" :size="16" class="mt-0.5 shrink-0 text-ok" />Full refund of both payments on proof of a failed attempt within 90 days of purchase</li>
          <li class="flex gap-2.5"><Icon name="check" :size="16" class="mt-0.5 shrink-0 text-ok" />Requires five completed full-length mocks — the thing that predicts passing</li>
        </ul>
        <div class="mt-6">
          <template v-if="native && ready">
            <AppButton
              v-if="!ownedGuarantee"
              variant="secondary"
              size="lg"
              block
              :loading="purchases.busy.value"
              :disabled="!guaranteePkg || !owned"
              @click="buy(guaranteePkg, 'guarantee')"
            >{{ owned ? 'Add the guarantee' : 'Requires Complete' }}</AppButton>
            <p v-else class="text-center text-[13.5px] font-medium text-ok">Guarantee active.</p>
          </template>
          <p v-else-if="!native" class="text-[12px] leading-relaxed text-muted">
            Available with Complete in the app; on the web when checkout opens.
          </p>
        </div>
      </AppCard>
    </div>

    <div class="mx-auto grid max-w-2xl gap-3.5 text-center text-[13px] leading-relaxed text-muted">
      <template v-if="native">
        <p v-if="notice" class="rounded-card border border-warn/25 bg-warn-soft px-4 py-3 text-left text-ink-2">
          {{ notice }}
          <NuxtLink v-if="!auth.signedIn.value" to="/signin" class="font-medium text-accent hover:underline hover:underline-offset-4">Sign in</NuxtLink>
        </p>
        <p v-if="purchases.error.value" class="text-danger" role="alert">{{ purchases.error.value }}</p>
        <p>
          Bought before?
          <button type="button" class="font-medium text-accent hover:underline hover:underline-offset-4 disabled:text-muted" :disabled="purchases.busy.value" @click="restore">Restore purchases</button>
        </p>
      </template>
      <p>
        Purchases are not shareable across accounts: readiness and the plan are computed from one
        person's answers, so a shared account degrades for everyone using it.
      </p>
      <p>
        <NuxtLink to="/legal/refunds" class="underline underline-offset-4 hover:text-ink-2">Refunds &amp; guarantee terms</NuxtLink>
        ·
        <NuxtLink to="/legal/disclaimer" class="underline underline-offset-4 hover:text-ink-2">Trademark disclaimer</NuxtLink>
      </p>
    </div>
  </div>
</template>
