<script setup lang="ts">
/**
 * Whatever the operator most recently needed every learner to know.
 *
 * Dismissible, unlike ImpersonationBar: this is information, not a state the reader is in, and a
 * notice that cannot be closed becomes furniture people stop reading. Dismissal is per publish, so
 * the next announcement still gets through.
 */
const ann = useAnnouncement();
onMounted(() => { void ann.load(); });

const tones = {
  info: "border-accent/40 bg-accent-soft",
  warn: "border-warn bg-warn-soft",
  danger: "border-danger bg-danger-soft",
};
const icons = { info: "info", warn: "alert", danger: "alert" } as const;
</script>
<template>
  <div
    v-if="ann.visible.value && ann.current.value"
    class="border-b print:hidden"
    :class="tones[ann.current.value.tone]"
    role="status"
  >
    <div class="safe-px mx-auto flex max-w-5xl items-start gap-2.5 py-2.5">
      <Icon :name="icons[ann.current.value.tone]" :size="16" class="mt-px shrink-0" />
      <p class="m-0 min-w-0 flex-1 text-[13px] font-medium leading-relaxed">{{ ann.current.value.message }}</p>
      <button
        type="button"
        class="tap -my-1 -mr-1.5 grid shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:text-ink"
        aria-label="Dismiss"
        @click="ann.dismiss()"
      ><Icon name="x" :size="16" /></button>
    </div>
  </div>
</template>
