<script setup lang="ts">
defineProps<{ label: string; value: string; hint?: string; tone?: "ok" | "warn" | "danger" | "default"; to?: string }>();
</script>
<template>
  <component
    :is="to ? resolveComponent('NuxtLink') : 'div'"
    :to="to"
    class="block rounded-card border border-line bg-surface p-4 text-ink no-underline focus-visible:outline-2 focus-visible:outline-accent"
    :class="to ? 'hover:border-accent' : ''"
  >
    <div class="text-xs font-medium uppercase tracking-wide text-muted">{{ label }}</div>
    <div
      class="mt-1 text-2xl font-semibold tabular-nums"
      :class="{ 'text-ok': tone === 'ok', 'text-warn': tone === 'warn', 'text-danger': tone === 'danger' }"
    >{{ value }}</div>
    <div v-if="hint" class="mt-1 text-xs text-muted">{{ hint }}</div>
  </component>
</template>
