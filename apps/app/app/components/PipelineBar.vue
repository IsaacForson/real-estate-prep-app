<script setup lang="ts">
import type { Pipeline } from "~~/lib/study/srs";
const props = defineProps<{ p: Pipeline }>();
const total = computed(() => props.p.red + props.p.yellow + props.p.green + props.p.unseen || 1);
</script>
<template>
  <div style="margin: 10px 0">
    <div class="bar">
      <span class="g" :style="{ width: (100 * p.green / total) + '%' }" /><span class="y" :style="{ width: (100 * p.yellow / total) + '%' }" /><span class="r" :style="{ width: (100 * p.red / total) + '%' }" />
    </div>
    <div class="row muted" style="font-size:13px; margin-top:6px">
      <span class="pill green">{{ p.green }} green</span><span class="pill yellow">{{ p.yellow }} yellow</span><span class="pill red">{{ p.red }} red</span>
      <span>{{ p.unseen }} unseen · {{ p.dueNow }} due now<template v-if="p.leeches"> · {{ p.leeches }} leeches</template></span>
    </div>
  </div>
</template>
