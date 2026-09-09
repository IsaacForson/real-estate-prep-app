<script setup lang="ts">
/**
 * Loading placeholder. `lines` stacks text rows; otherwise a single block of the given
 * class/height. Uses the `shimmer` sweep rather than a pulse — a moving highlight reads as
 * "loading", a fading block reads as "disabled". Both stop under `prefers-reduced-motion`.
 */
withDefaults(defineProps<{ lines?: number; class?: string; height?: string }>(), { lines: 0, height: "1rem" });
</script>
<template>
  <div aria-hidden="true">
    <template v-if="lines">
      <div
        v-for="i in lines"
        :key="i"
        class="shimmer mb-2 h-3.5 rounded-md last:mb-0"
        :style="{ width: i === lines ? '60%' : '100%' }"
      />
    </template>
    <div v-else class="shimmer rounded-card" :class="$props.class" :style="{ height }" />
  </div>
</template>
