<script setup lang="ts">
import type { Readiness } from "~~/lib/study/readiness";
defineProps<{ r: Readiness }>();
</script>
<template>
  <div class="row" style="justify-content:space-between; margin-bottom:10px">
    <div>
      <div style="font-size:28px; font-weight:700">{{ r.expectedPct.toFixed(0) }}%<span class="muted" style="font-size:14px"> predicted · 90% range {{ r.low90.toFixed(0) }}–{{ r.high90.toFixed(0) }} of {{ r.scoredItems }}</span></div>
      <div class="muted" style="font-size:14px">
        <template v-if="r.passProbability != null">Chance of passing ({{ r.passThreshold }} needed): <strong>{{ (100 * r.passProbability).toFixed(0) }}%</strong> · </template>
        confidence {{ r.confidence }} ({{ r.answersUsed }} answers) · <NuxtLink to="/methodology">how this is computed</NuxtLink>
      </div>
    </div>
  </div>
</template>
