<script setup lang="ts">
import type { IconName } from "~/components/Icon.vue";
const { items, dismiss } = useAdminToast();
const glyph = (kind: string): IconName => (kind === "error" ? "x-circle" : kind === "ok" ? "check-circle" : "info");
</script>
<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
    <div
      v-for="t in items"
      :key="t.id"
      class="anim-fade-up pointer-events-auto flex items-start gap-2.5 rounded-card border bg-surface p-3 text-[13.5px] text-ink shadow-float"
      :class="t.kind === 'error' ? 'border-danger/35' : t.kind === 'ok' ? 'border-ok/35' : 'border-line'"
      role="status"
    >
      <Icon
        :name="glyph(t.kind)"
        :size="16"
        class="mt-px shrink-0"
        :class="t.kind === 'error' ? 'text-danger' : t.kind === 'ok' ? 'text-ok' : 'text-accent'"
      />
      <span class="flex-1 break-words leading-snug">{{ t.text }}</span>
      <button
        type="button"
        class="-mr-0.5 shrink-0 text-muted transition-colors hover:text-ink"
        aria-label="Dismiss"
        @click="dismiss(t.id)"
      ><Icon name="x" :size="14" /></button>
    </div>
  </div>
</template>
