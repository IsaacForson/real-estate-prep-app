<script setup lang="ts">
/**
 * Logo: the section sign (§) — the statute citation behind every answer — on a solid tile.
 * The tile uses the `action` pair rather than the accent so the mark reads as a mark, not as a
 * button, and so it survives being placed on an accent surface. `light` forces the inverted pair
 * for dark heroes.
 */
withDefaults(defineProps<{ size?: number; wordmark?: boolean; light?: boolean }>(), { size: 32, wordmark: false });
</script>
<template>
  <span class="inline-flex select-none items-center gap-2.5">
    <span
      class="grid place-items-center rounded-[30%] font-serif font-semibold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,.16)]"
      :class="light ? 'bg-white text-[#12161c]' : 'bg-action text-action-ink'"
      :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.6}px` }"
      aria-hidden="true"
    >§</span>
    <span
      v-if="wordmark"
      class="font-semibold leading-none tracking-[-0.022em]"
      :style="{ fontSize: `${Math.round(size * 0.55)}px` }"
    >CitePass</span>
  </span>
</template>
