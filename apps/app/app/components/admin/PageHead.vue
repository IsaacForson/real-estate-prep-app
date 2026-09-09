<script setup lang="ts">
/** Every console screen opens the same way: what this page is, one line of why, then its controls. */
defineProps<{ title: string; subtitle?: string }>();
</script>
<template>
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0">
      <h1 class="m-0 text-[19px] font-semibold tracking-[-0.018em]">{{ title }}</h1>
      <p v-if="subtitle" class="m-0 mt-0.5 text-[13px] leading-snug text-muted">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-2"><slot /></div>
  </div>
</template>
