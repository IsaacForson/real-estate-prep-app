<script setup lang="ts">
/**
 * Labelled text input / textarea / select with hint + error. `v-model` string.
 * Fields sit on `paper` rather than `surface` so they read as recessed against a card.
 * Errors are announced: `aria-invalid` plus `aria-describedby` pointing at the message.
 */
const props = withDefaults(defineProps<{
  modelValue: string;
  label?: string;
  hint?: string;
  error?: string | null;
  type?: string;
  placeholder?: string;
  autocomplete?: string;
  inputmode?: "text" | "numeric" | "email" | "decimal" | "search" | "tel" | "url";
  required?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  multiline?: boolean;
  rows?: number;
  options?: Array<{ value: string; label: string }>;
  maxlength?: number;
  pattern?: string;
  id?: string;
}>(), { type: "text", rows: 4 });
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();
const uid = props.id ?? `f-${Math.random().toString(36).slice(2, 8)}`;

const box =
  "w-full min-h-11 px-3.5 rounded-card border bg-paper text-ink placeholder:text-muted/60 " +
  "transition-[border-color,box-shadow] duration-150 ease-standard " +
  "focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/20 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";
const edge = computed(() => (props.error ? "border-danger focus:border-danger focus:ring-danger/20" : "border-line hover:border-line-strong"));
</script>
<template>
  <label class="block" :for="uid">
    <span v-if="label" class="block text-[13.5px] font-medium text-ink-2 mb-1.5">
      {{ label }}<span v-if="required" class="text-danger"> *</span>
    </span>

    <select
      v-if="options"
      :id="uid"
      :value="modelValue"
      :disabled="disabled"
      :required="required"
      :class="[box, edge]"
      :aria-invalid="!!error || undefined"
      :aria-describedby="error || hint ? `${uid}-d` : undefined"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>

    <textarea
      v-else-if="multiline"
      :id="uid"
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="required"
      :maxlength="maxlength"
      :class="[box, edge, 'py-2.5 leading-relaxed resize-y']"
      :aria-invalid="!!error || undefined"
      :aria-describedby="error || hint ? `${uid}-d` : undefined"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />

    <input
      v-else
      :id="uid"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      :disabled="disabled"
      :required="required"
      :autofocus="autofocus"
      :maxlength="maxlength"
      :pattern="pattern"
      :class="[box, edge]"
      :aria-invalid="!!error || undefined"
      :aria-describedby="error || hint ? `${uid}-d` : undefined"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />

    <span v-if="error" :id="`${uid}-d`" class="mt-1.5 flex items-start gap-1.5 text-[13px] text-danger">
      <Icon name="alert" :size="14" class="mt-px" />{{ error }}
    </span>
    <span v-else-if="hint" :id="`${uid}-d`" class="mt-1.5 block text-[12.5px] leading-snug text-muted">{{ hint }}</span>
  </label>
</template>
