<script setup lang="ts">
/**
 * Free-tier notice: a quiet counter while questions remain, the upgrade card once they're used up.
 * Renders nothing for a Complete account. Numbers come from the server (useFreeTier).
 *
 * The counter is deliberately understated — a permanent nag would train people to ignore it, and
 * the hard stop is doing the persuading anyway.
 */
defineProps<{ variant?: "banner" | "block" }>();
const free = useFreeTier();
const auth = useAuth();
const applies = computed(() => auth.ready.value && free.applies.value);
onMounted(() => { void free.load(); });
</script>
<template>
  <AppCard v-if="applies && free.exhausted.value" tone="accent" padding="lg">
    <div class="flex items-start gap-3.5">
      <span class="grid size-10 shrink-0 place-items-center rounded-card bg-accent text-accent-ink">
        <Icon name="lock" :size="19" />
      </span>
      <div class="grid min-w-0 gap-2.5">
        <h2 class="text-[18px] font-semibold leading-tight tracking-[-0.016em]">You've used your free questions</h2>
        <p class="text-[14px] leading-relaxed text-ink-2">
          Every one came with its explanation and statute citation — that is the whole free tier, honestly.
          <strong class="font-semibold text-ink">Complete</strong> is $59 once, forever: all 51 jurisdictions,
          both national banks, every mock, no daily limits.
        </p>
        <div class="flex flex-wrap gap-2 pt-1">
          <AppButton to="/pricing" variant="primary" icon-right="arrow-right">See Complete — $59 once</AppButton>
        </div>
      </div>
    </div>
  </AppCard>

  <div
    v-else-if="applies && variant !== 'block'"
    class="flex items-center gap-3 rounded-card border border-dashed border-line-strong px-3.5 py-2.5"
  >
    <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2"><Icon name="gift" :size="16" /></span>
    <p class="flex-1 text-[13.5px] leading-snug text-ink-2">
      Free tier: <strong class="tabular font-semibold text-ink">{{ free.remaining.value }}</strong> questions<template v-if="free.jurisdiction.value"> in {{ free.jurisdiction.value }}</template>
      and <strong class="tabular font-semibold text-ink">{{ free.mocksRemaining.value }}</strong> short mock left.
    </p>
    <NuxtLink to="/pricing" class="shrink-0 text-[13.5px] font-medium text-accent underline underline-offset-2">Unlock</NuxtLink>
  </div>
</template>
