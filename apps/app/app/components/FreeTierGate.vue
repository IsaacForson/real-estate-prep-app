<script setup lang="ts">
/**
 * Free-tier notice: a quiet counter while questions remain, the upgrade card once they're used up.
 * Renders nothing for a Complete account. Numbers come from the server (useFreeTier).
 */
defineProps<{ variant?: "banner" | "block" }>();
const free = useFreeTier();
const auth = useAuth();
const applies = computed(() => auth.ready.value && free.applies.value);
onMounted(() => { void free.load(); });
</script>
<template>
  <AppCard v-if="applies && free.exhausted.value" tone="accent" padding="lg">
    <div class="flex items-start gap-3">
      <span class="grid place-items-center size-10 rounded-xl bg-accent text-accent-ink shrink-0"><Icon name="lock" :size="20" /></span>
      <div class="grid gap-2 min-w-0">
        <h2 class="text-lg font-semibold leading-tight">You've used your free questions</h2>
        <p class="text-sm text-ink-2">Every one came with its explanation and statute citation — that is the whole free tier, honestly. <strong>Complete</strong> is $59 once, forever: all 51 jurisdictions, both national banks, every mock, no daily limits.</p>
        <div class="flex flex-wrap gap-2 pt-1">
          <AppButton to="/pricing" variant="primary" icon-right="arrow-right">See Complete — $59 once</AppButton>
        </div>
      </div>
    </div>
  </AppCard>
  <div v-else-if="applies && variant !== 'block'" class="flex items-center gap-3 rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-sm">
    <span class="grid place-items-center size-8 rounded-lg bg-surface-2 text-ink-2 shrink-0"><Icon name="gift" :size="16" /></span>
    <p class="flex-1 text-ink-2 leading-snug">
      Free tier: <strong class="tabular">{{ free.remaining.value }}</strong> questions<template v-if="free.jurisdiction.value"> in {{ free.jurisdiction.value }}</template> and <strong class="tabular">{{ free.mocksRemaining.value }}</strong> short mock left.
    </p>
    <NuxtLink to="/pricing" class="text-accent font-medium text-sm shrink-0">Unlock</NuxtLink>
  </div>
</template>
