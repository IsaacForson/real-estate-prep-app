<script setup lang="ts">
/** Legacy pre-V2 URL. The study loop is now at /app. */
definePageMeta({ layout: false });
await navigateTo("/app", { replace: true, redirectCode: 301 });
</script>
<template>
  <div />
</template>
