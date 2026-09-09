<script setup lang="ts">
import { JURISDICTIONS } from "@rep/schema";
import type { IconName } from "./Icon.vue";
/**
 * The app's entire navigation surface.
 *
 * There is no tab bar and no sidebar: the study loop owns the screen, and everything that is not
 * "answer the next question" lives behind this one panel. That is the whole point of the
 * information architecture — a learner should never have to choose a destination before they can
 * start working, and the things they check occasionally (readiness, mocks, glossary, settings)
 * should not cost five permanent tabs of screen furniture.
 *
 * Geometry, focus handling and scroll locking follow AppSheet; this is taller and wider because it
 * is a place you look around in rather than a question you answer.
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void; (e: "change-state"): void }>();

const studyState = useStudyState();
const readiness = useReadiness();
const entitlement = useEntitlement();
const content = useContent();
const study = useStudy();

const panel = ref<HTMLElement | null>(null);
let opener: Element | null = null;
const FOCUSABLE = "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])";

const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);
const level = computed(() => studyState.settings.value?.licenseLevel ?? "salesperson");
const stateName = computed(() => (jur.value ? JURISDICTIONS[jur.value as keyof typeof JURISDICTIONS] ?? jur.value : null));
const examDate = computed(() => studyState.settings.value?.examDate ?? null);
const daysLeft = computed(() =>
  examDate.value ? Math.ceil((new Date(examDate.value + "T00:00").getTime() - Date.now()) / 86_400_000) : null,
);

/** Due count for the Review row. Only computed while the panel is up — it walks all progress. */
const due = ref<number | null>(null);
const banks = computed(() => {
  const v = jur.value ? content.manifest.value?.states[jur.value]?.vendor : null;
  return [
    jur.value ? `state_${jur.value}` : null,
    v === "psi" ? "national_psi" : v === "pearsonvue" ? "national_pearsonvue" : null,
  ].filter((b): b is string => !!b);
});
async function loadDue() {
  try {
    let n = 0;
    for (const b of banks.value) n += (await study.pipelineFor(b)).dueNow;
    due.value = n;
  } catch { due.value = null; }
}

const rows = computed<Array<{ to: string; label: string; hint: string; icon: IconName; count?: number | null }>>(() => [
  { to: "/app/mocks", label: "Timed mock", hint: "Sit the real exam format", icon: "clock" },
  { to: "/app/review", label: "Review", hint: "Missed questions and your boxes", icon: "refresh", count: due.value },
  { to: "/app/study", label: "Progress", hint: "Readiness and section coverage", icon: "target" },
  { to: "/app/glossary", label: "Glossary", hint: "Terms with their citations", icon: "book" },
  { to: "/app/account", label: "Account", hint: "Plan, exam date, settings", icon: "user" },
]);

function close() { emit("close"); }

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

watch(() => props.open, (o) => {
  if (!import.meta.client) return;
  if (o) {
    opener = document.activeElement;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    void loadDue();
    nextTick(() => (panel.value?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.value)?.focus());
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
      <div class="absolute inset-0 bg-black/55 backdrop-blur-[3px] motion-safe:animate-[cp-fade-up_.2s_ease-out]" @click="close" />

      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabindex="-1"
        class="relative flex max-h-[94dvh] w-full flex-col bg-bg text-ink shadow-float outline-none
               rounded-t-panel sm:max-w-lg sm:rounded-panel sm:border sm:border-line
               anim-sheet-up sm:anim-scale-in"
      >
        <div class="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <span class="h-1.5 w-10 rounded-pill bg-line-strong" />
        </div>

        <!-- who you are studying as; tapping the state is how you change it -->
        <header class="flex items-center justify-between gap-3 px-4 pt-3.5">
          <button
            type="button"
            class="group -ml-1 flex min-w-0 items-center gap-2 rounded-pill px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
            @click="emit('change-state')"
          >
            <span class="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <Icon name="map" :size="19" />
            </span>
            <span class="min-w-0">
              <span class="block truncate text-[16px] font-extrabold leading-tight">{{ stateName ?? 'Choose your state' }}</span>
              <span class="block text-[12.5px] capitalize text-muted">{{ level }}</span>
            </span>
            <Icon name="chevron-down" :size="16" class="shrink-0 text-muted transition-colors group-hover:text-ink" />
          </button>

          <button
            type="button"
            class="tap -mr-1 grid shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="Close menu"
            @click="close"
          ><Icon name="x" :size="20" /></button>
        </header>

        <div class="safe-pb overflow-y-auto px-4 pb-5 pt-4">
          <FreeTierGate variant="banner" class="mb-4" />

          <!-- the two numbers that answer "am I ready yet" -->
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <p class="eyebrow">National</p>
              <p class="tabular mt-1 text-[26px] font-extrabold leading-none">
                <template v-if="readiness.national.value">{{ readiness.national.value.expectedPct.toFixed(0) }}<span class="text-[16px] text-muted">%</span></template>
                <template v-else>—</template>
              </p>
            </div>
            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <p class="eyebrow">State</p>
              <p class="tabular mt-1 text-[26px] font-extrabold leading-none">
                <template v-if="readiness.state.value">{{ readiness.state.value.expectedPct.toFixed(0) }}<span class="text-[16px] text-muted">%</span></template>
                <template v-else>—</template>
              </p>
            </div>
          </div>

          <div
            v-if="daysLeft != null"
            class="mt-3 flex items-center gap-2.5 rounded-card px-4 py-3 text-[14px] font-bold"
            :class="daysLeft <= 7 ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent'"
          >
            <Icon name="calendar" :size="18" />
            <span v-if="daysLeft < 0">Your exam date has passed</span>
            <span v-else-if="daysLeft === 0">Your exam is today</span>
            <span v-else>{{ daysLeft }} {{ daysLeft === 1 ? 'day' : 'days' }} until your exam</span>
          </div>

          <nav class="mt-4 grid gap-2" aria-label="App">
            <NuxtLink
              v-for="r in rows"
              :key="r.to"
              :to="r.to"
              class="flex min-h-[4rem] items-center gap-3.5 rounded-card border border-line bg-surface p-3.5 shadow-card
                     transition-[transform,border-color] duration-150 ease-standard hover:border-line-strong active:scale-[0.99]"
              @click="close"
            >
              <span class="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">
                <Icon :name="r.icon" :size="21" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-[15.5px] font-extrabold leading-tight">{{ r.label }}</span>
                <span class="block truncate text-[12.5px] text-muted">{{ r.hint }}</span>
              </span>
              <Badge v-if="r.count" tone="accent" size="md">{{ r.count }} due</Badge>
              <Icon name="chevron-right" :size="18" class="shrink-0 text-muted" />
            </NuxtLink>
          </nav>

          <div class="mt-4 flex items-center justify-center gap-4 text-[13px] font-bold text-muted">
            <NuxtLink to="/help" class="hover:text-ink" @click="close">Help</NuxtLink>
            <span aria-hidden="true">·</span>
            <NuxtLink v-if="!entitlement.isComplete.value" to="/pricing" class="hover:text-ink" @click="close">Get Complete</NuxtLink>
            <NuxtLink v-else to="/app/account" class="hover:text-ink" @click="close">Complete unlocked</NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
