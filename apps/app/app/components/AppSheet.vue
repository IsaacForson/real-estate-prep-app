<script setup lang="ts">
/**
 * Bottom sheet on small screens, centred dialog from `sm:` up. Teleported to <body>, closes on
 * backdrop tap and Escape, returns focus to the opener, locks page scroll while open, and keeps
 * Tab inside the panel while it is up.
 */
const props = withDefaults(defineProps<{ open: boolean; title?: string; description?: string; dismissible?: boolean }>(), { dismissible: true });
const emit = defineEmits<{ (e: "close"): void }>();
const panel = ref<HTMLElement | null>(null);
let opener: Element | null = null;

const FOCUSABLE = "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])";

function close() { if (props.dismissible) emit("close"); }

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { close(); return; }
  if (e.key !== "Tab" || !panel.value) return;
  // Focus trap: a modal the keyboard can walk out of is not modal.
  const nodes = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !panel.value.contains(active))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}

watch(() => props.open, (o) => {
  if (!import.meta.client) return;
  if (o) {
    opener = document.activeElement;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    nextTick(() => (panel.value?.querySelector<HTMLElement>(`[autofocus],${FOCUSABLE}`) ?? panel.value)?.focus());
  } else {
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    (opener as HTMLElement | null)?.focus?.();
  }
}, { immediate: true });

onUnmounted(() => {
  if (!import.meta.client) return;
  document.body.style.overflow = "";
  document.removeEventListener("keydown", onKey);
});
</script>
<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" role="presentation">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-[3px] motion-safe:animate-[cp-fade-up_.2s_ease-out]" @click="close" />
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
        class="relative flex max-h-[92dvh] w-full flex-col bg-surface text-ink shadow-float outline-none
               rounded-t-panel sm:max-w-md sm:rounded-panel sm:border sm:border-line
               anim-sheet-up sm:anim-scale-in"
      >
        <div class="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <span class="h-1 w-9 rounded-pill bg-line-strong" />
        </div>

        <header v-if="title || dismissible" class="flex items-start justify-between gap-3 px-5 pt-3.5 pb-1">
          <div class="min-w-0">
            <h2 v-if="title" class="text-[17px] font-semibold tracking-[-0.014em]">{{ title }}</h2>
            <p v-if="description" class="mt-1 text-[13.5px] leading-relaxed text-muted">{{ description }}</p>
          </div>
          <button
            v-if="dismissible"
            type="button"
            class="tap -mr-2 -mt-1.5 grid place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="Close"
            @click="close"
          ><Icon name="x" :size="19" /></button>
        </header>

        <div class="overflow-y-auto px-5 pt-2 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+1rem))]"><slot /></div>
      </div>
    </div>
  </Teleport>
</template>
