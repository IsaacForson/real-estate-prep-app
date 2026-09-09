<script setup lang="ts">
/** No chrome at all: welcome carousel and sign-in on every platform. */
</script>
<template>
  <div class="min-h-dvh bg-bg text-ink flex flex-col safe-pt safe-pb">
    <slot />
    <Toast />
  </div>
</template>
