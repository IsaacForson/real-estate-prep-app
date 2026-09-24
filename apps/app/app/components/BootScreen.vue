<script setup lang="ts">
/**
 * Full-screen splash for the gap after Vue mounts and before auth.init() finishes.
 * The HTML shell shows spa-loading-template.html until then; this takes over so a
 * client-only route never paints an empty page.
 */
</script>
<template>
  <div class="fixed inset-0 z-[80] grid place-content-center justify-items-center gap-3.5 bg-bg" role="status" aria-live="polite" aria-label="Loading">
    <BrandMark :size="44" />
    <span class="size-[18px] animate-spin rounded-full border-2 border-line border-t-accent motion-reduce:animate-none" aria-hidden="true" />
  </div>
</template>
