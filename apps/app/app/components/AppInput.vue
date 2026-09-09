<script setup lang="ts">
/** Labelled text input / textarea / select with hint + error. `v-model` string. */
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
const box = "w-full min-h-12 px-3.5 rounded-xl border bg-surface text-ink placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-accent/35 focus:border-accent disabled:opacity-50 transition-shadow";
</script>
<template>
  <label class="block" :for="uid">
    <span v-if="label" class="block text-sm font-medium text-ink-2 mb-1.5">{{ label }}<span v-if="required" class="text-danger"> *</span></span>
    <select v-if="options" :id="uid" :value="modelValue" :disabled="disabled" :required="required" :class="[box, error ? 'border-danger' : 'border-line']" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <textarea v-else-if="multiline" :id="uid" :value="modelValue" :rows="rows" :placeholder="placeholder" :disabled="disabled" :required="required" :maxlength="maxlength" :class="[box, 'py-3 resize-y', error ? 'border-danger' : 'border-line']" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
    <input v-else :id="uid" :type="type" :value="modelValue" :placeholder="placeholder" :autocomplete="autocomplete" :inputmode="inputmode" :disabled="disabled" :required="required" :autofocus="autofocus" :maxlength="maxlength" :pattern="pattern" :class="[box, error ? 'border-danger' : 'border-line']" :aria-invalid="!!error || undefined" :aria-describedby="error || hint ? `${uid}-d` : undefined" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
    <span v-if="error" :id="`${uid}-d`" class="block text-sm text-danger mt-1.5">{{ error }}</span>
    <span v-else-if="hint" :id="`${uid}-d`" class="block text-xs text-muted mt-1.5">{{ hint }}</span>
  </label>
</template>
