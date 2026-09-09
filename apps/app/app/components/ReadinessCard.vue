<script setup lang="ts">
import type { Readiness } from "~~/lib/study/readiness";
/**
 * Readiness ring + the honest numbers behind it (range, pass probability, confidence).
 * The range and the confidence badge are shown at the same weight as the headline number on
 * purpose: a single big percentage would imply more precision than the estimate has.
 */
const props = withDefaults(defineProps<{ r: Readiness | null; title?: string; compact?: boolean }>(), { title: "Readiness" });
const has = computed(() => !!props.r && props.r.answersUsed > 0);
const pct = computed(() => (has.value ? Math.round(props.r!.expectedPct) : 0));
const conf = { low: "warn", medium: "neutral", high: "ok" } as const;
</script>
<template>
  <div class="flex items-center gap-4 sm:gap-5">
    <ProgressRing :value="pct" :size="compact ? 84 : 112" :stroke="compact ? 8 : 9" :label="`${title} ${pct} percent`">
      <span class="grid leading-none">
        <span class="tabular font-semibold tracking-[-0.03em]" :class="compact ? 'text-xl' : 'text-[30px]'">
          {{ has ? pct : '—' }}<span v-if="has" class="text-sm font-medium text-muted">%</span>
        </span>
        <span v-if="!compact" class="eyebrow mt-1.5 text-[9.5px]">predicted</span>
      </span>
    </ProgressRing>

    <div class="grid min-w-0 flex-1 gap-1.5">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-[15px] font-semibold tracking-[-0.012em]">{{ title }}</h3>
        <Badge v-if="has && r" :tone="conf[r.confidence]">{{ r.confidence }} confidence</Badge>
      </div>

      <template v-if="has && r">
        <p class="tabular text-[13.5px] leading-snug text-ink-2">
          90% range <strong class="font-semibold text-ink">{{ r.low90.toFixed(0) }}–{{ r.high90.toFixed(0) }}</strong>
          <span class="text-muted"> of {{ r.scoredItems }} items</span>
        </p>
        <p v-if="r.passProbability != null" class="text-[13.5px] leading-snug text-ink-2">
          Chance of passing<span class="text-muted"> ({{ r.passThreshold }} needed)</span>:
          <strong class="tabular font-semibold text-ink">{{ (100 * r.passProbability).toFixed(0) }}%</strong>
        </p>
        <p class="text-[12px] text-muted">
          From {{ r.answersUsed }} answers ·
          <NuxtLink to="/methodology" class="underline underline-offset-2 hover:text-ink-2">how this is computed</NuxtLink>
        </p>
      </template>

      <p v-else class="text-[13.5px] leading-relaxed text-muted">
        Answer a few questions and your predicted score appears here. Only answers count — never reads.
      </p>
    </div>
  </div>
</template>
