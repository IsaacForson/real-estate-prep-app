<script setup lang="ts">
/**
 * Slim header for every `/app/**` screen. Home is the base of the app — nothing to go "back" to —
 * so it shows the brand mark instead of a back arrow; every other screen (mocks, review, progress,
 * glossary, account) gets the back arrow to Home. The menu button on the right is always there.
 */
defineProps<{ title: string; home?: boolean }>();
const panel = useAppPanel();
</script>
<template>
  <header class="safe-pt sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-xl">
    <div class="safe-px mx-auto flex h-15 max-w-3xl items-center gap-2">
      <BrandMark v-if="home" :size="24" wordmark class="min-w-0 flex-1" />
      <template v-else>
        <NuxtLink
          to="/app"
          class="tap -ml-2.5 grid shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-surface-2"
          aria-label="Back to studying"
        ><Icon name="arrow-left" :size="21" :stroke-width="2.1" /></NuxtLink>

        <h1 class="min-w-0 flex-1 truncate text-[17px] font-extrabold">{{ title }}</h1>
      </template>

      <button
        type="button"
        class="tap -mr-2.5 grid shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-surface-2"
        aria-label="Open menu"
        @click="panel.show()"
      ><Icon name="menu" :size="21" :stroke-width="2.1" /></button>
    </div>
  </header>
</template>
