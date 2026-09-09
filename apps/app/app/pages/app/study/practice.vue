<script setup lang="ts">
/**
 * The practice runner used to live here. The study loop is now the app's front door (pages/app/
 * index.vue), so this route only exists to catch old links, deep links and any in-flight session
 * that was resumed from another device against the previous URL.
 */
definePageMeta({ layout: false });
await navigateTo("/app", { replace: true });
</script>
<template>
  <div />
</template>
