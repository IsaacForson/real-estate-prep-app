<script setup lang="ts">
/** Segmented control. `v-model` holds the selected tab's `value`. */
const props = defineProps<{ tabs: Array<{ value: string; label: string; count?: number | null }>; modelValue: string; ariaLabel?: string }>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();
function onKey(e: KeyboardEvent, i: number) {
  const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  const next = props.tabs[(i + dir + props.tabs.length) % props.tabs.length]!;
  emit("update:modelValue", next.value);
  (e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>("[role=tab]")[props.tabs.indexOf(next)]?.focus();
}
</script>
<template>
  <div role="tablist" :aria-label="ariaLabel" class="inline-flex w-full p-1 rounded-xl bg-surface-2 gap-1">
    <button
      v-for="(t, i) in tabs" :key="t.value" role="tab" type="button"
      :aria-selected="t.value === modelValue" :tabindex="t.value === modelValue ? 0 : -1"
      class="flex-1 min-h-10 px-3 rounded-lg text-sm font-medium transition-colors inline-flex items-center justify-center gap-1.5"
      :class="t.value === modelValue ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'"
      @click="emit('update:modelValue', t.value)" @keydown="onKey($event, i)"
    >
      {{ t.label }}
      <span v-if="t.count != null" class="text-xs tabular rounded-pill px-1.5 py-px" :class="t.value === modelValue ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-muted'">{{ t.count }}</span>
    </button>
  </div>
</template>
