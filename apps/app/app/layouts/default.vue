<script setup lang="ts">
/**
 * Thin alias. WP-B's layout plugin points `default` at `mobile` on Capacitor and `web` otherwise;
 * this file exists so pages without an explicit layout still render before that plugin lands.
 */
</script>
<template>
  <NuxtLayout name="web"><slot /></NuxtLayout>
</template>
