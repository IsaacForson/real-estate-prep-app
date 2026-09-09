<script setup lang="ts">
/** Segmented control. `v-model` holds the selected tab's `value`. Arrow keys move between tabs. */
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
  <div role="tablist" :aria-label="ariaLabel" class="inline-flex w-full gap-0.5 rounded-card border border-line bg-surface-2 p-1">
    <button
      v-for="(t, i) in tabs"
      :key="t.value"
      role="tab"
      type="button"
      :aria-selected="t.value === modelValue"
      :tabindex="t.value === modelValue ? 0 : -1"
      class="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-[13.5px] font-medium transition-[background-color,color,box-shadow] duration-150 ease-standard"
      :class="t.value === modelValue
        ? 'bg-surface text-ink shadow-card'
        : 'text-muted hover:text-ink-2'"
      @click="emit('update:modelValue', t.value)"
      @keydown="onKey($event, i)"
    >
      {{ t.label }}
      <span
        v-if="t.count != null"
        class="tabular rounded-pill px-1.5 py-px text-[11px] font-semibold"
        :class="t.value === modelValue ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-muted'"
      >{{ t.count }}</span>
    </button>
  </div>
</template>
