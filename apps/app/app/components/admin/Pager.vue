<script setup lang="ts">
/** Cursor paging: `hasPrev` when the page stack has history, `next` when the API returned a cursor. */
defineProps<{ page: number; count: number; hasPrev: boolean; hasNext: boolean; loading?: boolean; label?: string }>();
const emit = defineEmits<{ prev: []; next: [] }>();
</script>
<template>
  <nav class="mt-3.5 flex items-center justify-between gap-3 text-[12.5px] text-muted" aria-label="Pagination">
    <span class="tabular">Page {{ page }} · {{ count }} {{ label ?? "rows" }}</span>
    <div class="flex gap-1.5">
      <AppButton variant="secondary" size="xs" icon="chevron-left" :disabled="!hasPrev || loading" @click="emit('prev')">Previous</AppButton>
      <AppButton variant="secondary" size="xs" icon-right="chevron-right" :disabled="!hasNext || loading" @click="emit('next')">Next</AppButton>
    </div>
  </nav>
</template>
