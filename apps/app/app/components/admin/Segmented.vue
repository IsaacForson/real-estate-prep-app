<script setup lang="ts">
/**
 * Dense segmented control for console filters (time range, status). Same idea as `AppTabs` but
 * sized for a toolbar rather than a phone: the console is a mouse-and-keyboard surface, so 44px
 * targets would waste the row.
 */
const props = defineProps<{ options: Array<{ value: string; label: string }>; modelValue: string; ariaLabel?: string }>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

function onKey(e: KeyboardEvent, i: number) {
  const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  const next = props.options[(i + dir + props.options.length) % props.options.length]!;
  emit("update:modelValue", next.value);
  (e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>("[role=tab]")[props.options.indexOf(next)]?.focus();
}
</script>
<template>
  <div role="tablist" :aria-label="ariaLabel" class="inline-flex gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
    <button
      v-for="(o, i) in options"
      :key="o.value"
      role="tab"
      type="button"
      :aria-selected="o.value === modelValue"
      :tabindex="o.value === modelValue ? 0 : -1"
      class="rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors duration-150 ease-standard"
      :class="o.value === modelValue ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink-2'"
      @click="emit('update:modelValue', o.value)"
      @keydown="onKey($event, i)"
    >{{ o.label }}</button>
  </div>
</template>
