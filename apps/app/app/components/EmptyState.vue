<script setup lang="ts">
import type { IconName } from "./Icon.vue";
/**
 * Empty state. Always says what the surface is for and what to do next — an empty screen that
 * only says "nothing here" makes the user wonder whether the app is broken.
 */
withDefaults(defineProps<{ icon?: IconName; title: string; body?: string; compact?: boolean }>(), { icon: "spark" });
</script>
<template>
  <div class="flex flex-col items-center text-center" :class="compact ? 'py-7' : 'py-14'">
    <span class="grid size-11 place-items-center rounded-panel border border-line bg-surface-2 text-muted">
      <Icon :name="icon" :size="20" />
    </span>
    <h3 class="mt-3.5 text-[15px] font-semibold">{{ title }}</h3>
    <p v-if="body" class="mt-1.5 max-w-[34ch] text-[13.5px] leading-relaxed text-muted">{{ body }}</p>
    <div v-if="$slots.default" class="mt-4 flex flex-wrap justify-center gap-2"><slot /></div>
  </div>
</template>
