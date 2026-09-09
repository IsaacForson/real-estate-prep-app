<script setup lang="ts">
/** Logo: the section sign (§) — the statute citation behind every answer — on a rounded tile. */
withDefaults(defineProps<{ size?: number; wordmark?: boolean; light?: boolean }>(), { size: 32, wordmark: false });
</script>
<template>
  <span class="inline-flex items-center gap-2.5 select-none">
    <span class="grid place-items-center rounded-[28%] font-serif font-bold leading-none shadow-[inset_0_-2px_0_rgba(0,0,0,.18)]" :class="light ? 'bg-white text-[#2d3fc4]' : 'bg-accent text-accent-ink'" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.62}px` }" aria-hidden="true">§</span>
    <span v-if="wordmark" class="font-semibold tracking-tight leading-none" :style="{ fontSize: `${Math.round(size * 0.55)}px` }">Exam Prep<span class="text-muted font-normal"> · 51</span></span>
  </span>
</template>
