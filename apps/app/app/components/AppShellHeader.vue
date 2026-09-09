<script setup lang="ts">
/**
 * Signed-in app header. Same chrome as the public TopBar (pricing, help): chevron back, title,
 * trailing actions. Home has no back step. The menu button is always on the right.
 */
defineProps<{ title: string; home?: boolean }>();
const panel = useAppPanel();
</script>
<template>
  <TopBar :title="title" :back="home ? false : true">
    <button
      type="button"
      class="tap grid shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-surface-2"
      aria-label="Open menu"
      @click="panel.show()"
    ><Icon name="menu" :size="21" :stroke-width="2.1" /></button>
  </TopBar>
</template>
