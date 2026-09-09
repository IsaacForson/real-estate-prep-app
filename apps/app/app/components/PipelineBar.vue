<script setup lang="ts">
import type { Pipeline } from "~~/lib/study/srs";
/** SRS boxes as a stacked bar + legend: red (due now) · yellow · green · unseen. */
const props = defineProps<{ p: Pipeline; showLegend?: boolean }>();
const total = computed(() => props.p.red + props.p.yellow + props.p.green + props.p.unseen || 1);
const w = (n: number) => `${(100 * n) / total.value}%`;
</script>
<template>
  <div class="grid gap-2">
    <div class="h-2.5 rounded-pill bg-surface-3 overflow-hidden flex" role="img" :aria-label="`${p.green} green, ${p.yellow} yellow, ${p.red} red, ${p.unseen} unseen`">
      <span class="h-full bg-ok" :style="{ width: w(p.green) }" />
      <span class="h-full bg-warn" :style="{ width: w(p.yellow) }" />
      <span class="h-full bg-danger" :style="{ width: w(p.red) }" />
    </div>
    <div v-if="showLegend !== false" class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted tabular">
      <span class="inline-flex items-center gap-1"><i class="size-2 rounded-full bg-ok" />{{ p.green }} green</span>
      <span class="inline-flex items-center gap-1"><i class="size-2 rounded-full bg-warn" />{{ p.yellow }} yellow</span>
      <span class="inline-flex items-center gap-1"><i class="size-2 rounded-full bg-danger" />{{ p.red }} red</span>
      <span>{{ p.unseen }} unseen</span>
      <span v-if="p.dueNow">· {{ p.dueNow }} due now</span>
      <span v-if="p.leeches">· {{ p.leeches }} leeches</span>
    </div>
  </div>
</template>
