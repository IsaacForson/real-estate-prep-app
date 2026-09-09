<script setup lang="ts">
withDefaults(defineProps<{
  title?: string;
  subtitle?: string;
  tone?: "default" | "accent" | "paper" | "flat";
  padding?: "none" | "sm" | "md" | "lg";
  as?: string;
}>(), { tone: "default", padding: "md", as: "section" });
const pad = { none: "", sm: "p-3", md: "p-4 sm:p-5", lg: "p-5 sm:p-7" };
const tones = {
  default: "bg-surface border border-line shadow-card",
  accent: "bg-accent-soft border border-transparent",
  paper: "bg-paper border border-line",
  flat: "bg-surface-2 border border-transparent",
};
</script>
<template>
  <component :is="as" class="rounded-card overflow-hidden" :class="[tones[tone], pad[padding]]">
    <header v-if="title || $slots.header" class="flex items-start justify-between gap-3" :class="padding === 'none' ? 'px-4 sm:px-5 pt-4 pb-3' : 'mb-3'">
      <div class="min-w-0">
        <h2 v-if="title" class="text-[17px] font-semibold leading-snug">{{ title }}</h2>
        <p v-if="subtitle" class="text-sm text-muted mt-0.5">{{ subtitle }}</p>
      </div>
      <slot name="header" />
    </header>
    <slot />
  </component>
</template>
