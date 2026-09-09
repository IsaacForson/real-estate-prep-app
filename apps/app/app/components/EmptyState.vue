<script setup lang="ts">
import type { IconName } from "./Icon.vue";
withDefaults(defineProps<{ icon?: IconName; title: string; body?: string; compact?: boolean }>(), { icon: "spark" });
</script>
<template>
  <div class="text-center flex flex-col items-center gap-2" :class="compact ? 'py-6' : 'py-12'">
    <span class="grid place-items-center size-12 rounded-2xl bg-surface-2 text-muted"><Icon :name="icon" :size="22" /></span>
    <h3 class="font-semibold text-[15px] mt-1">{{ title }}</h3>
    <p v-if="body" class="text-sm text-muted max-w-xs">{{ body }}</p>
    <div v-if="$slots.default" class="mt-2 flex flex-wrap justify-center gap-2"><slot /></div>
  </div>
</template>
