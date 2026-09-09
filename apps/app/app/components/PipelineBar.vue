<script setup lang="ts">
import type { Pipeline } from "~~/lib/study/srs";
/** SRS boxes as a stacked bar + legend: green (solid) · yellow · red (due now) · unseen. */
const props = defineProps<{ p: Pipeline; showLegend?: boolean }>();
const total = computed(() => props.p.red + props.p.yellow + props.p.green + props.p.unseen || 1);
const w = (n: number) => `${(100 * n) / total.value}%`;
</script>
<template>
  <div class="grid gap-2.5">
    <div
      class="flex h-2 gap-px overflow-hidden rounded-pill bg-surface-3"
      role="img"
      :aria-label="`${p.green} green, ${p.yellow} yellow, ${p.red} red, ${p.unseen} unseen`"
    >
      <span class="h-full bg-ok transition-[width] duration-500 ease-emphasized" :style="{ width: w(p.green) }" />
      <span class="h-full bg-warn transition-[width] duration-500 ease-emphasized" :style="{ width: w(p.yellow) }" />
      <span class="h-full bg-danger transition-[width] duration-500 ease-emphasized" :style="{ width: w(p.red) }" />
    </div>

    <div v-if="showLegend !== false" class="tabular flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] text-muted">
      <span class="inline-flex items-center gap-1.5"><i class="size-1.5 rounded-full bg-ok" />{{ p.green }} green</span>
      <span class="inline-flex items-center gap-1.5"><i class="size-1.5 rounded-full bg-warn" />{{ p.yellow }} yellow</span>
      <span class="inline-flex items-center gap-1.5"><i class="size-1.5 rounded-full bg-danger" />{{ p.red }} red</span>
      <span>{{ p.unseen }} unseen</span>
      <span v-if="p.dueNow" class="text-ink-2">· {{ p.dueNow }} due now</span>
      <span v-if="p.leeches">· {{ p.leeches }} leeches</span>
    </div>
  </div>
</template>
