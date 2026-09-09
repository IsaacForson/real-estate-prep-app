<script setup lang="ts">
import type { IconName } from "./Icon.vue";
withDefaults(defineProps<{ label: string; value: string | number; hint?: string; icon?: IconName; tone?: "default" | "ok" | "warn" | "danger" | "accent"; to?: string }>(), { tone: "default" });
const toneText = { default: "text-ink", ok: "text-ok", warn: "text-warn", danger: "text-danger", accent: "text-accent" };
</script>
<template>
  <component :is="to ? 'NuxtLink' : 'div'" :to="to" class="rounded-card bg-surface border border-line p-3.5 flex flex-col gap-1 min-w-0" :class="to ? 'hover:bg-surface-2 transition-colors' : ''">
    <div class="flex items-center justify-between gap-2 text-muted">
      <span class="text-xs font-medium truncate">{{ label }}</span>
      <Icon v-if="icon" :name="icon" :size="16" />
    </div>
    <div class="text-2xl font-semibold tabular leading-none tracking-tight" :class="toneText[tone]">{{ value }}</div>
    <div v-if="hint" class="text-xs text-muted truncate">{{ hint }}</div>
  </component>
</template>
