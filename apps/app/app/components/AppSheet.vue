<script setup lang="ts">
/**
 * Bottom sheet on small screens, centred dialog from `sm:` up. Teleported to <body>, closes on
 * backdrop tap and Escape, returns focus to the opener, locks page scroll while open.
 */
const props = withDefaults(defineProps<{ open: boolean; title?: string; description?: string; dismissible?: boolean }>(), { dismissible: true });
const emit = defineEmits<{ (e: "close"): void }>();
const panel = ref<HTMLElement | null>(null);
let opener: Element | null = null;

function close() { if (props.dismissible) emit("close"); }
function onKey(e: KeyboardEvent) { if (e.key === "Escape") close(); }

watch(() => props.open, (o) => {
  if (!import.meta.client) return;
  if (o) {
    opener = document.activeElement;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    nextTick(() => panel.value?.querySelector<HTMLElement>("[autofocus],button,input,textarea,select,a[href]")?.focus());
  } else {
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    (opener as HTMLElement | null)?.focus?.();
  }
}, { immediate: true });
onUnmounted(() => { if (import.meta.client) { document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); } });
</script>
<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" role="presentation">
      <div class="absolute inset-0 bg-black/45 backdrop-blur-[2px]" @click="close" />
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        class="relative w-full sm:max-w-md bg-surface text-ink rounded-t-[var(--radius-lg)] sm:rounded-[var(--radius-lg)] shadow-float anim-sheet-up max-h-[92dvh] flex flex-col"
      >
        <div class="sm:hidden pt-2.5 flex justify-center" aria-hidden="true"><span class="h-1.5 w-10 rounded-pill bg-line-strong" /></div>
        <header v-if="title || dismissible" class="px-5 pt-3 pb-1 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 v-if="title" class="text-lg font-semibold">{{ title }}</h2>
            <p v-if="description" class="text-sm text-muted mt-0.5">{{ description }}</p>
          </div>
          <button v-if="dismissible" type="button" class="tap -mr-2 -mt-1 grid place-items-center rounded-full text-muted hover:bg-surface-2" aria-label="Close" @click="close"><Icon name="x" /></button>
        </header>
        <div class="px-5 pb-5 overflow-y-auto safe-pb"><slot /></div>
      </div>
    </div>
  </Teleport>
</template>
