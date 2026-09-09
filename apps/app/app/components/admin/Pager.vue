<script setup lang="ts">
/** Cursor paging: `hasPrev` when the page stack has history, `next` when the API returned a cursor. */
defineProps<{ page: number; count: number; hasPrev: boolean; hasNext: boolean; loading?: boolean; label?: string }>();
const emit = defineEmits<{ prev: []; next: [] }>();
</script>
<template>
  <nav class="mt-3 flex items-center justify-between gap-3 text-sm text-muted" aria-label="Pagination">
    <span>Page {{ page }} · {{ count }} {{ label ?? "rows" }}</span>
    <div class="flex gap-2">
      <button type="button" class="!px-3 !py-1 text-sm" :disabled="!hasPrev || loading" @click="emit('prev')">← Previous</button>
      <button type="button" class="!px-3 !py-1 text-sm" :disabled="!hasNext || loading" @click="emit('next')">Next →</button>
    </div>
  </nav>
</template>
