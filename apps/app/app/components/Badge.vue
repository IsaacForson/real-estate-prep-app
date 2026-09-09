<script setup lang="ts">
/** Small state chip. Tone maps to the semantic palette — never used for actions. */
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
  <span
    class="inline-flex items-center gap-1 whitespace-nowrap rounded-pill font-medium leading-none"
    :class="[tones[tone], size === 'sm' ? 'px-2 py-1 text-[11.5px]' : 'px-2.5 py-1.5 text-[13px]']"
  ><slot /></span>
</template>
