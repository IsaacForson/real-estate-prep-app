<script setup lang="ts">
defineProps<{ label: string; value: string; hint?: string; tone?: "ok" | "warn" | "danger" | "default"; to?: string }>();
</script>
<template>
  <component
    :is="to ? resolveComponent('NuxtLink') : 'div'"
    :to="to"
    class="block rounded-card border border-line bg-surface p-4 text-ink no-underline transition-colors"
    :class="to ? 'hover:border-line-strong hover:bg-surface-2' : ''"
  >
    <div class="eyebrow">{{ label }}</div>
    <div
      class="tabular mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.028em]"
      :class="{ 'text-ok': tone === 'ok', 'text-warn': tone === 'warn', 'text-danger': tone === 'danger' }"
    >{{ value }}</div>
    <div v-if="hint" class="mt-1.5 text-[11.5px] text-muted">{{ hint }}</div>
  </component>
</template>
