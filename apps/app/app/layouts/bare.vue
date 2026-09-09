<script setup lang="ts">
/** No chrome at all: welcome carousel and sign-in on every platform. */
</script>
<template>
  <div class="safe-pt safe-pb flex min-h-dvh flex-col bg-bg text-ink">
    <slot />
    <Toast />
  </div>
</template>
