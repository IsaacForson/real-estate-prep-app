<script setup lang="ts">
withDefaults(defineProps<{ tone?: "neutral" | "accent" | "ok" | "warn" | "danger" | "outline"; size?: "sm" | "md" }>(), { tone: "neutral", size: "sm" });
const tones = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  outline: "border border-line text-muted",
};
</script>
<template>
  <span class="inline-flex items-center gap-1 rounded-pill font-medium whitespace-nowrap" :class="[tones[tone], size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1']"><slot /></span>
</template>
