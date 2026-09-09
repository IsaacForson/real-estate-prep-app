<script setup lang="ts">
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { pushToast } from "~/components/Toast.vue";
/**
 * The pass guarantee, offered to people who already bought Complete.
 *
 * This is the only add-on in the product, and until now the only place to buy it was the marketing
 * pricing page — which a paying learner has no reason to ever open again. So the add-on was
 * effectively unsellable after the first purchase. It belongs where paid learners actually are: the
 * account screen and the menu.
 *
 * It renders nothing unless it applies (Complete owned, guarantee not), so it can be dropped into a
 * surface without a `v-if` at the call site.
 *
 * `card` is the full pitch for the account screen; `row` is one line for the menu panel.
 */
withDefaults(defineProps<{ variant?: "card" | "row" }>(), { variant: "card" });

const auth = useAuth();
const entitlement = useEntitlement();
const purchases = usePurchases();
const events = useEvents();

const owned = computed(() => entitlement.isComplete.value || purchases.hasComplete.value);
const hasGuarantee = computed(() => entitlement.hasGuarantee.value || purchases.hasGuarantee.value);
const applies = computed(() => auth.signedIn.value && auth.ready.value && owned.value && !hasGuarantee.value);

const pkg = computed<PurchasesPackage | undefined>(() =>
  purchases.packages.value.find((p) => p.product.identifier === PRODUCT_IDS.guarantee || p.product.identifier.startsWith(`${PRODUCT_IDS.guarantee}:`))
);
const price = computed(() => pkg.value?.product.priceString ?? "$20");
/** Off the stores we cannot take money yet, so the honest move is to say so, not to fake a button. */
const canBuyHere = computed(() => purchases.supported.value && !!pkg.value);

async function buy() {
  if (!pkg.value) return;
  events.track("purchase_started", { product: "guarantee", store: "store" });
  await purchases.buy(pkg.value);
  if (purchases.error.value) { events.track("purchase_failed", { product: "guarantee", error: purchases.error.value }); return; }
  if (purchases.hasGuarantee.value) {
    events.track("purchase_succeeded", { product: "guarantee" });
    // the webhook grants the row; poll briefly so the badge flips without a reload
    for (const wait of [1500, 4000, 8000]) {
      await new Promise((r) => setTimeout(r, wait));
      await entitlement.refresh();
      if (entitlement.hasGuarantee.value) break;
    }
    pushToast("Pass guarantee added. Sit the exam knowing you are covered.", "ok");
  }
}
</script>
<template>
  <template v-if="applies">
    <!-- compact: one line in the menu, next to everything else you might tap -->
    <NuxtLink
      v-if="variant === 'row'"
      to="/pricing"
      class="flex min-h-[3.5rem] items-center gap-3 rounded-card border border-accent/40 bg-accent-soft p-3.5 transition-colors hover:border-accent"
    >
      <span class="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-white"><Icon name="shield" :size="18" /></span>
      <span class="min-w-0 flex-1">
        <span class="block text-[14px] font-extrabold leading-tight">Add the pass guarantee</span>
        <span class="block truncate text-[12px] text-ink-2">{{ price }} — your money back if you fail</span>
      </span>
      <Icon name="chevron-right" :size="17" class="shrink-0 text-accent" />
    </NuxtLink>

    <AppCard v-else tone="accent" title="Pass guarantee" :subtitle="`${price} once, on top of Complete`">
      <p class="text-[14px] leading-relaxed text-ink-2">
        If you sit the exam and fail, you get back everything you paid — Complete and the guarantee
        both. You need five full mocks finished in the app before the attempt and your official score
        report within 30 days of it, which is roughly what it takes to be ready anyway.
      </p>

      <div class="mt-4 grid gap-2">
        <AppButton
          v-if="canBuyHere"
          variant="primary"
          size="lg"
          block
          icon="shield"
          :loading="purchases.busy.value"
          @click="buy"
        >Add it for {{ price }}</AppButton>
        <template v-else>
          <AppButton to="/pricing" variant="secondary" size="lg" block icon-right="arrow-right">See the terms</AppButton>
          <p class="text-center text-[12px] leading-relaxed text-muted">
            The add-on is bought in the phone app; web checkout is still opening. Nothing expires
            while you wait — you can add it any time before your exam.
          </p>
        </template>
        <p v-if="purchases.error.value" class="text-[13px] text-danger">{{ purchases.error.value }}</p>
        <NuxtLink to="/legal/refunds" class="text-center text-[12px] text-muted underline-offset-4 hover:text-ink hover:underline">
          Full guarantee terms
        </NuxtLink>
      </div>
    </AppCard>
  </template>
</template>
