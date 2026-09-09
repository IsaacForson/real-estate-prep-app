<script setup lang="ts">
/** Loading placeholder. `lines` stacks text rows; otherwise a single block of the given class/height. */
withDefaults(defineProps<{ lines?: number; class?: string; height?: string }>(), { lines: 0, height: "1rem" });
</script>
<template>
  <div aria-hidden="true" class="animate-pulse">
    <template v-if="lines">
      <div v-for="i in lines" :key="i" class="h-3.5 rounded-md bg-surface-3 mb-2 last:mb-0" :style="{ width: i === lines ? '60%' : '100%' }" />
    </template>
    <div v-else class="rounded-xl bg-surface-3" :class="$props.class" :style="{ height }" />
  </div>
</template>
