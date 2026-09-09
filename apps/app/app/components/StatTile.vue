<script setup lang="ts">
import type { IconName } from "./Icon.vue";
/** One metric. Values use `tabular` so a row of tiles keeps its digits aligned. */
withDefaults(defineProps<{ label: string; value: string | number; hint?: string; icon?: IconName; tone?: "default" | "ok" | "warn" | "danger" | "accent"; to?: string }>(), { tone: "default" });
const toneText = { default: "text-ink", ok: "text-ok", warn: "text-warn", danger: "text-danger", accent: "text-accent" };
</script>
<template>
  <component
    :is="to ? 'NuxtLink' : 'div'"
    :to="to"
    class="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-3.5"
    :class="to ? 'transition-colors hover:border-line-strong hover:bg-surface-2' : ''"
  >
    <div class="flex items-center justify-between gap-2 text-muted">
      <span class="truncate text-[11.5px] font-medium">{{ label }}</span>
      <Icon v-if="icon" :name="icon" :size="15" />
    </div>
    <div class="tabular text-[26px] font-semibold leading-none tracking-[-0.028em]" :class="toneText[tone]">{{ value }}</div>
    <div v-if="hint" class="truncate text-[11.5px] text-muted">{{ hint }}</div>
  </component>
</template>
