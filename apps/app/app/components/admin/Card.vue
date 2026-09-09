<script setup lang="ts">
defineProps<{ title?: string; subtitle?: string; flush?: boolean }>();
</script>
<template>
  <section class="rounded-card border border-line bg-surface" :class="flush ? '' : 'p-4'">
    <header v-if="title || $slots.actions" class="mb-3 flex flex-wrap items-center justify-between gap-2" :class="flush ? 'px-4 pt-4' : ''">
      <div>
        <h2 v-if="title" class="m-0 text-base font-semibold text-ink">{{ title }}</h2>
        <p v-if="subtitle" class="m-0 text-sm text-muted">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>
