<script setup lang="ts">
/** One answer option. States: idle → selected (pre-reveal) → correct / wrong / dimmed (post-reveal). */
const props = defineProps<{ letter: string; text: string; state: "idle" | "selected" | "correct" | "wrong" | "dimmed"; disabled?: boolean }>();
const emit = defineEmits<{ (e: "choose"): void }>();
const box = computed(() => ({
  idle: "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
  selected: "border-accent bg-accent-soft ring-2 ring-accent/30",
  correct: "border-ok bg-ok-soft",
  wrong: "border-danger bg-danger-soft",
  dimmed: "border-line bg-surface opacity-60",
}[props.state]));
const badge = computed(() => ({
  idle: "bg-surface-2 text-ink-2",
  selected: "bg-accent text-accent-ink",
  correct: "bg-ok text-white",
  wrong: "bg-danger text-white",
  dimmed: "bg-surface-2 text-muted",
}[props.state]));
</script>
<template>
  <button
    type="button"
    class="w-full text-left flex items-start gap-3 p-3.5 rounded-xl border transition-[background-color,border-color,transform] duration-150 active:scale-[0.99] disabled:active:scale-100 min-h-14"
    :class="box"
    :disabled="disabled"
    :aria-pressed="state === 'selected' || undefined"
    @click="emit('choose')"
  >
    <span class="grid place-items-center size-7 shrink-0 rounded-lg text-sm font-semibold transition-colors" :class="badge" aria-hidden="true">
      <Icon v-if="state === 'correct'" name="check" :size="16" :stroke-width="2.6" />
      <Icon v-else-if="state === 'wrong'" name="x" :size="16" :stroke-width="2.6" />
      <template v-else>{{ letter }}</template>
    </span>
    <span class="sr-only">Option {{ letter }}<template v-if="state === 'correct'">, correct answer</template><template v-if="state === 'wrong'">, your incorrect answer</template>.</span>
    <span class="text-[15px] leading-snug pt-0.5 text-ink">{{ text }}</span>
  </button>
</template>
