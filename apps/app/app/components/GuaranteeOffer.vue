<script setup lang="ts">
import { pushToast } from "~/components/Toast.vue";
/**
 * The pass guarantee, offered to people who already bought Complete.
 *
 * `card` is the full pitch for the account screen; `row` is one line for the menu. Both buy here —
 * they must not dump a paying learner onto the marketing pricing page, which on the web used to
 * have no purchase button at all.
 */
withDefaults(defineProps<{ variant?: "card" | "row" }>(), { variant: "card" });

const auth = useAuth();
const entitlement = useEntitlement();
const purchases = usePurchases();
const checkout = useCheckout();

const owned = computed(() => entitlement.isComplete.value || purchases.hasComplete.value);
const hasGuarantee = computed(() => entitlement.hasGuarantee.value || purchases.hasGuarantee.value);
const applies = computed(() => auth.signedIn.value && auth.ready.value && owned.value && !hasGuarantee.value);
const pkg = computed(() => checkout.pkgFor("guarantee"));
const price = computed(() => pkg.value?.product.priceString ?? "$20");
const busy = computed(() => checkout.busy.value || purchases.busy.value);

async function buy() {
  const ok = await checkout.buy("guarantee");
  if (!ok) {
    pushToast(checkout.error.value ?? "Could not start checkout.", "warn");
    return;
  }
  if (entitlement.hasGuarantee.value || purchases.hasGuarantee.value) {
    pushToast("Pass guarantee added. Sit the exam knowing you are covered.", "ok");
  }
}
</script>
<template>
  <template v-if="applies">
    <button
      v-if="variant === 'row'"
      type="button"
      class="flex min-h-[3.5rem] w-full items-center gap-3 rounded-card border border-accent/40 bg-accent-soft p-3.5 text-left transition-colors hover:border-accent disabled:opacity-60"
      :disabled="busy"
      @click="buy"
    >
      <span class="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-white"><Icon name="shield" :size="18" /></span>
      <span class="min-w-0 flex-1">
        <span class="block text-[14px] font-extrabold leading-tight">{{ busy ? "Opening checkout…" : "Add the pass guarantee" }}</span>
        <span class="block truncate text-[12px] text-ink-2">{{ price }} — your money back if you fail</span>
      </span>
      <Icon name="chevron-right" :size="17" class="shrink-0 text-accent" />
    </button>

    <AppCard v-else tone="accent" title="Pass guarantee" :subtitle="`${price} once, on top of Complete`">
      <p class="text-[14px] leading-relaxed text-ink-2">
        If you sit the exam and fail, you get back everything you paid — Complete and the guarantee
        both. You need the required mocks finished in the app before the attempt and your official
        score report inside the claim window.
      </p>

      <div class="mt-4 grid gap-2">
        <AppButton
          variant="primary"
          size="lg"
          block
          icon="shield"
          :loading="busy"
          @click="buy"
        >Add it for {{ price }}</AppButton>
        <p v-if="checkout.error.value || purchases.error.value" class="text-[13px] text-danger">
          {{ checkout.error.value || purchases.error.value }}
        </p>
        <NuxtLink to="/legal/refunds" class="text-center text-[12px] text-muted underline-offset-4 hover:text-ink hover:underline">
          Full guarantee terms
        </NuxtLink>
      </div>
    </AppCard>
  </template>
</template>
