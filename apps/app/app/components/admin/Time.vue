<script setup lang="ts">
/** Relative time with the absolute timestamp as a tooltip (and in `datetime`). */
const props = defineProps<{ value: string | number | null | undefined; absolute?: boolean }>();
const iso = computed(() => {
  if (!props.value) return undefined;
  const d = new Date(props.value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
});
</script>
<template>
  <time v-if="value" :datetime="iso" :title="adminFmt.abs(value)" class="tabular whitespace-nowrap">
    {{ absolute ? adminFmt.abs(value) : adminFmt.relative(value) }}
  </time>
  <span v-else class="text-muted">—</span>
</template>
