<script setup lang="ts">
/**
 * Overlay dialog. Teleported out of the page so a parent `overflow: hidden` cannot clip it.
 *
 * Mobile WebView used to lose this sheet in two ways:
 * 1. The opening tap's leftover `click` landed on a new `@click` backdrop and dismissed it.
 * 2. `flex items-end` pinned the panel to the bottom of an oversized `fixed inset-0` box, so the
 *    dialog sat below the visual viewport (desktop `items-center` never had that problem).
 *
 * Backdrop dismisses only on a pointer that both started and ended on the dimmer, after a short
 * arming window. The close button always works. The panel is centred on every width.
 */
const props = withDefaults(defineProps<{ open: boolean; title?: string; description?: string; dismissible?: boolean }>(), { dismissible: true });
const emit = defineEmits<{ (e: "close"): void }>();
const panel = ref<HTMLElement | null>(null);
let opener: Element | null = null;
let armed = false;
let armTimer: number | null = null;
let backdropPointer: number | null = null;

const FOCUSABLE = "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])";

function close() {
  if (!props.dismissible) return;
  emit("close");
}

function onBackdropPointerDown(e: PointerEvent) {
  if (e.target !== e.currentTarget) return;
  backdropPointer = e.pointerId;
}

function onBackdropPointerUp(e: PointerEvent) {
  const same = backdropPointer === e.pointerId;
  backdropPointer = null;
  if (!armed || !same || e.target !== e.currentTarget) return;
  close();
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { close(); return; }
  if (e.key !== "Tab" || !panel.value) return;
  const nodes = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !panel.value.contains(active))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}

function disarm() {
  armed = false;
  backdropPointer = null;
  if (armTimer != null) { window.clearTimeout(armTimer); armTimer = null; }
}

watch(() => props.open, (o) => {
  if (!import.meta.client) return;
  if (o) {
    opener = document.activeElement;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    disarm();
    // Longer than Android's leftover click (~300–500ms) from the control that opened us.
    armTimer = window.setTimeout(() => { armed = true; armTimer = null; }, 700);
    nextTick(() => panel.value?.focus());
  } else {
    disarm();
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    (opener as HTMLElement | null)?.focus?.();
  }
}, { immediate: true });

onUnmounted(() => {
  if (!import.meta.client) return;
  disarm();
  document.body.style.overflow = "";
  document.removeEventListener("keydown", onKey);
});
</script>
<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-80 grid place-items-center p-3 sm:p-6" role="presentation">
      <div
        class="absolute inset-0 bg-black/50"
        @pointerdown="onBackdropPointerDown"
        @pointerup="onBackdropPointerUp"
      />
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
        class="relative z-10 flex max-h-[min(92svh,40rem)] w-full max-w-md flex-col overflow-hidden bg-surface text-ink shadow-float outline-none rounded-panel border border-line"
      >
        <header v-if="title || dismissible" class="flex items-start justify-between gap-3 px-5 pt-4 pb-1">
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
