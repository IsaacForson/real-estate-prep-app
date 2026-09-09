<script setup lang="ts">
/**
 * Slim header for the secondary app screens (mocks, review, progress, glossary, account).
 *
 * The study loop is home, so "back" always means back to the loop rather than into a tab
 * hierarchy, and the menu button on the right is the only navigation affordance in the product.
 */
defineProps<{ title: string }>();
const panel = useAppPanel();
</script>
<template>
  <header class="safe-pt sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-xl">
    <div class="safe-px mx-auto flex h-15 max-w-3xl items-center gap-2">
      <NuxtLink
        to="/app"
        class="tap -ml-2.5 grid shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-surface-2"
        aria-label="Back to studying"
      ><Icon name="arrow-left" :size="21" :stroke-width="2.1" /></NuxtLink>

      <h1 class="min-w-0 flex-1 truncate text-[17px] font-extrabold">{{ title }}</h1>

      <button
        type="button"
        class="tap -mr-2.5 grid shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-surface-2"
        aria-label="Open menu"
        @click="panel.show()"
      ><Icon name="menu" :size="21" :stroke-width="2.1" /></button>
    </div>
  </header>
</template>
