<script setup lang="ts">
import type { Readiness } from "~~/lib/study/readiness";
/** Readiness ring + the honest numbers behind it (range, pass probability, confidence). */
const props = withDefaults(defineProps<{ r: Readiness | null; title?: string; compact?: boolean }>(), { title: "Readiness" });
const has = computed(() => !!props.r && props.r.answersUsed > 0);
const pct = computed(() => has.value ? Math.round(props.r!.expectedPct) : 0);
const conf = { low: "warn", medium: "neutral", high: "ok" } as const;
</script>
<template>
  <div class="flex items-center gap-4">
    <ProgressRing :value="pct" :size="compact ? 84 : 116" :stroke="compact ? 8 : 10" :label="`${title} ${pct} percent`">
      <span class="grid leading-none">
        <span class="font-semibold tabular tracking-tight" :class="compact ? 'text-xl' : 'text-3xl'">{{ has ? pct : '—' }}<span class="text-sm font-medium text-muted" v-if="has">%</span></span>
        <span v-if="!compact" class="text-[10px] uppercase tracking-wider text-muted mt-1">predicted</span>
      </span>
    </ProgressRing>
    <div class="min-w-0 flex-1 grid gap-1">
      <div class="flex items-center gap-2 flex-wrap">
        <h3 class="font-semibold text-[15px]">{{ title }}</h3>
        <Badge v-if="has && r" :tone="conf[r.confidence]">{{ r.confidence }} confidence</Badge>
      </div>
      <template v-if="has && r">
        <p class="text-sm text-ink-2 tabular">90% range <strong>{{ r.low90.toFixed(0) }}–{{ r.high90.toFixed(0) }}</strong> of {{ r.scoredItems }} items</p>
        <p v-if="r.passProbability != null" class="text-sm text-ink-2">Chance of passing<span class="text-muted"> ({{ r.passThreshold }} needed)</span>: <strong class="tabular">{{ (100 * r.passProbability).toFixed(0) }}%</strong></p>
        <p class="text-xs text-muted">From {{ r.answersUsed }} answers · <NuxtLink to="/methodology" class="underline underline-offset-2">how this is computed</NuxtLink></p>
      </template>
      <p v-else class="text-sm text-muted">Answer a few questions and your predicted score appears here. Only answers count — never reads.</p>
    </div>
  </div>
</template>
