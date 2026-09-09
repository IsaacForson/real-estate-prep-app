<script setup lang="ts">
const { items, dismiss } = useAdminToast();
</script>
<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
    <div
      v-for="t in items"
      :key="t.id"
      class="pointer-events-auto flex items-start gap-2 rounded-card border bg-surface p-3 text-sm text-ink shadow-lg"
      :class="t.kind === 'error' ? 'border-danger/50' : t.kind === 'ok' ? 'border-ok/50' : 'border-line'"
      role="status"
    >
      <span class="mt-1 inline-block size-2 shrink-0 rounded-full" :class="t.kind === 'error' ? 'bg-danger' : t.kind === 'ok' ? 'bg-ok' : 'bg-accent'" aria-hidden="true" />
      <span class="flex-1 break-words">{{ t.text }}</span>
      <button type="button" class="!border-0 !bg-transparent !p-0 text-muted hover:text-ink" aria-label="Dismiss" @click="dismiss(t.id)">×</button>
    </div>
  </div>
</template>
