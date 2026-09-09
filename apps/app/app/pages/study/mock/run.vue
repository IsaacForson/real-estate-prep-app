<script setup lang="ts">
/** Legacy route: redirected to the /app shell. */
definePageMeta({ layout: "bare" });
await navigateTo("/app/mocks/run", { replace: true, redirectCode: 301 });
</script>
<template><div /></template>
