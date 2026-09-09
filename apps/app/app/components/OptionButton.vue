<script setup lang="ts">
/**
 * One answer option. States: idle → selected (pre-reveal) → correct / wrong / dimmed (post-reveal).
 *
 * Every state is carried by three signals at once — border, fill and the badge glyph — so the
 * answer is readable in greyscale, with colour blindness, and with motion disabled. Idle options
 * sit on a raised edge like the buttons do, which is what invites the tap.
 */
const props = defineProps<{ letter: string; text: string; state: "idle" | "selected" | "correct" | "wrong" | "dimmed"; disabled?: boolean }>();
const emit = defineEmits<{ (e: "choose"): void }>();

const box = computed(() => ({
  idle: "border-line bg-surface shadow-[0_3px_0_0_var(--border)] hover:border-line-strong active:translate-y-[3px] active:shadow-none",
  selected: "border-accent bg-accent-soft shadow-[0_3px_0_0_var(--accent)]",
  correct: "border-ok bg-ok-soft",
  wrong: "border-danger bg-danger-soft",
  dimmed: "border-line bg-surface opacity-50",
}[props.state]));

const badge = computed(() => ({
  idle: "border-2 border-line-strong bg-surface-2 text-ink-2",
  selected: "border-2 border-transparent bg-accent text-accent-ink",
  correct: "border-2 border-transparent bg-ok text-white",
  wrong: "border-2 border-transparent bg-danger text-white",
  dimmed: "border-2 border-line bg-surface-2 text-muted",
}[props.state]));
</script>
<template>
  <button
    type="button"
    class="flex min-h-[4rem] w-full items-center gap-3.5 rounded-card border-2 p-4 text-left
           transition-[background-color,border-color,box-shadow,opacity,transform] duration-150 ease-standard
           disabled:active:translate-y-0 disabled:active:shadow-[0_3px_0_0_var(--border)]"
    :class="box"
    :disabled="disabled"
    :aria-pressed="state === 'selected' || undefined"
    @click="emit('choose')"
  >
    <span
      class="grid size-9 shrink-0 place-items-center rounded-full text-[15px] font-extrabold transition-colors"
      :class="badge"
      aria-hidden="true"
    >
      <Icon v-if="state === 'correct'" name="check" :size="18" :stroke-width="3" />
      <Icon v-else-if="state === 'wrong'" name="x" :size="18" :stroke-width="3" />
      <template v-else>{{ letter }}</template>
    </span>

    <span class="sr-only">
      Option {{ letter }}<template v-if="state === 'correct'">, correct answer</template><template v-if="state === 'wrong'">, your incorrect answer</template>.
    </span>

    <span class="text-[15.5px] font-medium leading-snug text-ink">{{ text }}</span>
  </button>
</template>
