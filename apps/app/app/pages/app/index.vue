<script setup lang="ts">
import type { OptionLetter } from "@rep/schema";
import { OPTION_LETTERS } from "@rep/schema";
import type { StartPracticeOptions } from "~/composables/useStudy";
/**
 * The app. Not a dashboard — the study loop itself.
 *
 * Opening the app puts you on the next question. There is no home screen to read, no hub to pick a
 * mode from, and no session length to choose: `startPractice` already schedules due cards first, so
 * "what should I do next" is answered by the engine rather than by the learner. Everything else in
 * the product lives behind the menu button (components/AppPanel.vue).
 *
 * Phases:
 *   need-state → the one question that must be answered before anything can be scheduled
 *   question   → answer, reveal, continue, repeat
 *   milestone  → a batch finished; a rest point with the score and one button to keep going
 *   empty      → nothing schedulable; StudyIdle explains why and offers real alternatives
 *
 * The loop never dead-ends. Finishing a batch rolls straight into the next one, and even the empty
 * phase carries somewhere to go, which is what makes this feel like a study session rather than a
 * series of errands.
 */
useHead({ title: "Study" });

const study = useStudy();
const studyState = useStudyState();
const content = useContent();
const panel = useAppPanel();

const session = computed(() => study.session.value ?? study.activeSession.value);
const item = computed(() => study.current.value);

const chosen = ref<OptionLetter | null>(null);
const reveal = ref(false);
const startedAt = ref(Date.now());
const busy = ref(false);
const starting = ref(true);
const summary = ref<Awaited<ReturnType<typeof study.finish>> | null>(null);

const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);
const needState = computed(() => studyState.ready.value && !jur.value);

const total = computed(() => session.value?.itemIds.length ?? 0);
const position = computed(() => session.value?.position ?? 0);
const answers = computed(() => Object.values(session.value?.answers ?? {}));
const score = computed(() => ({ n: answers.value.length, c: answers.value.filter((a) => a.correct).length }));
const isLast = computed(() => position.value + 1 >= total.value);

const phase = computed<"need-state" | "milestone" | "question" | "empty" | "loading">(() => {
  if (needState.value) return "need-state";
  if (summary.value) return "milestone";
  if (session.value && item.value) return "question";
  if (starting.value) return "loading";
  return "empty";
});

/** Per-question verdict for the progress rail; ticks stay readable up to ~40 questions. */
const ticks = computed(() => {
  const s = session.value;
  if (!s || s.itemIds.length > 40) return null;
  return s.itemIds.map((id, i) => {
    if (i === position.value) return "current";
    const a = s.answers[id];
    return a ? (a.correct ? "correct" : "wrong") : "todo";
  });
});
const tickClass: Record<string, string> = {
  correct: "bg-ok",
  wrong: "bg-danger",
  current: "bg-accent",
  todo: "bg-surface-3",
};

const milestonePct = computed(() => {
  const s = summary.value;
  return s && s.total ? Math.round((100 * s.correct) / s.total) : 0;
});
const praise = computed(() => {
  const p = milestonePct.value;
  return p >= 90 ? "Excellent round" : p >= 75 ? "Passing pace" : p >= 50 ? "Getting there" : "Worth another look";
});

function restore() {
  const it = item.value;
  const s = session.value;
  const a = it && s ? s.answers[it.id] : undefined;
  chosen.value = a?.choice ?? null;
  reveal.value = !!a;
  startedAt.value = Date.now();
}
watch(() => item.value?.id, restore, { immediate: true });

/** Resume whatever was in flight, otherwise schedule a fresh batch. */
async function ensureSession() {
  starting.value = true;
  try {
    if (study.session.value && study.current.value) return;
    const active = study.activeSession.value;
    if (active && !active.endedAt) {
      // a mock is a different surface; send it back to its own runner
      if (active.kind === "mock") { await navigateTo("/app/mocks/run"); return; }
      if (await study.resume(active.id)) return;
    }
    // null means nothing is schedulable; the phase falls through to StudyIdle, which says why
    await study.startPractice({ kind: "practice" });
  } finally {
    starting.value = false;
  }
}

onMounted(async () => {
  await content.load();
  if (!needState.value) await ensureSession();
});
// picking a state (or changing it) is the trigger to schedule the first batch
watch(jur, async (j, prev) => {
  if (!j || j === prev) return;
  summary.value = null;
  await ensureSession();
});

async function choose(letter: OptionLetter) {
  if (!item.value || reveal.value || busy.value) return;
  busy.value = true;
  chosen.value = letter;
  try {
    await study.answer(letter);
    reveal.value = true;
  } finally { busy.value = false; }
}

async function advance() {
  if (busy.value) return;
  busy.value = true;
  try {
    if (isLast.value) { summary.value = await study.finish(); return; }
    await study.next();
  } finally { busy.value = false; }
}

async function keepGoing() {
  summary.value = null;
  await ensureSession();
}

/**
 * Start a specific kind of batch from the idle screen (national only, a leech drill, studying
 * ahead). Scheduling stays here so there is exactly one place that turns a session into the loop.
 */
async function startFrom(opts: StartPracticeOptions) {
  starting.value = true;
  try {
    summary.value = null;
    await study.startPractice(opts);
  } finally { starting.value = false; }
}

/** 1-4 / A-D pick an option, Enter or Space advances once revealed. Same actions as the buttons. */
function onKey(e: KeyboardEvent) {
  if (panel.open.value) return;
  const el = e.target as HTMLElement | null;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;

  if (phase.value === "milestone") {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void keepGoing(); }
    return;
  }
  if (phase.value !== "question") return;

  if (!reveal.value) {
    const digit = "1234".indexOf(e.key);
    const i = digit >= 0 ? digit : "abcd".indexOf(e.key.toLowerCase());
    const letter = i >= 0 ? OPTION_LETTERS[i] : undefined;
    if (letter && item.value?.options[i]) { e.preventDefault(); void choose(letter); }
    return;
  }
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void advance(); }
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>
<template>
  <div class="flex min-h-dvh flex-col">
    <!-- The only persistent chrome in the app: progress, score, and the way to everything else. -->
    <header class="safe-pt sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-xl">
      <div class="safe-px mx-auto flex h-15 max-w-3xl items-center gap-3">
        <div class="min-w-0 flex-1">
          <template v-if="phase === 'question'">
            <div class="flex items-baseline justify-between gap-3">
              <span class="tabular text-[14px] font-extrabold">
                {{ position + 1 }} <span class="font-bold text-muted">/ {{ total }}</span>
              </span>
              <span class="tabular text-[12.5px] font-bold text-muted">{{ score.c }}/{{ score.n }} correct</span>
            </div>

            <div v-if="ticks" class="mt-1.5 flex gap-[3px]" role="img" :aria-label="`Question ${position + 1} of ${total}`">
              <span v-for="(t, i) in ticks" :key="i" class="h-1.5 flex-1 rounded-pill transition-colors duration-300" :class="tickClass[t]" />
            </div>
            <div v-else class="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-surface-3">
              <span
                class="block h-full rounded-pill bg-accent transition-[width] duration-300 ease-emphasized"
                :style="{ width: (total ? (100 * position) / total : 0) + '%' }"
              />
            </div>
          </template>
          <BrandMark v-else :size="26" wordmark />
        </div>

        <button
          type="button"
          class="tap -mr-2.5 grid shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-surface-2"
          aria-label="Open menu"
          @click="panel.show()"
        ><Icon name="menu" :size="22" :stroke-width="2.1" /></button>
      </div>
    </header>

    <!-- First run. A single decision on its own screen, not a modal over an empty dashboard. -->
    <div v-if="phase === 'need-state'" class="safe-px anim-fade-up mx-auto grid w-full max-w-md flex-1 content-center gap-5 py-12 text-center">
      <span class="mx-auto grid size-20 place-items-center rounded-full bg-accent-soft text-accent">
        <Icon name="map" :size="38" />
      </span>
      <div class="grid gap-2.5">
        <h1 class="display text-[27px]">Which state are you licensing in?</h1>
        <p class="text-[15px] leading-relaxed text-ink-2">
          It decides which national exam you sit, how many questions you get, and what the state
          portion covers. On the free tier you get one state — you will confirm before it locks.
        </p>
      </div>
      <AppButton variant="primary" size="lg" block icon="map" @click="panel.statePicker.value = true">Choose your state</AppButton>
    </div>

    <!-- A batch just ended. A rest point, not a dead end. -->
    <div v-else-if="phase === 'milestone'" class="safe-px anim-scale-in mx-auto grid w-full max-w-md flex-1 content-center gap-6 py-12 text-center">
      <ProgressRing :value="milestonePct" :size="150" :stroke="12" class="mx-auto">
        <span class="grid leading-none">
          <span class="tabular text-[36px] font-extrabold">
            {{ summary?.correct ?? 0 }}<span class="text-[19px] font-bold text-muted">/{{ summary?.total ?? 0 }}</span>
          </span>
          <span class="eyebrow mt-2 text-[9.5px]">correct</span>
        </span>
      </ProgressRing>

      <div class="grid gap-2">
        <h1 class="display text-[25px]">{{ praise }}</h1>
        <p class="mx-auto max-w-[38ch] text-[14.5px] leading-relaxed text-ink-2">
          Your boxes and readiness are updated. Anything you missed comes back on its own schedule —
          there is nothing to file away.
        </p>
      </div>

      <div class="grid gap-2.5">
        <AppButton variant="primary" size="lg" block icon-right="arrow-right" :loading="starting" @click="keepGoing">Keep going</AppButton>
        <AppButton variant="ghost" size="lg" block @click="panel.show()">Something else</AppButton>
      </div>
    </div>

    <!--
      Nothing schedulable. StudyIdle works out why and gives the learner their numbers plus real
      routes out; an empty screen here is what makes a study app feel broken.
    -->
    <StudyIdle
      v-else-if="phase === 'empty'"
      @start="startFrom"
      @menu="panel.show()"
      @change-state="panel.statePicker.value = true"
    />

    <!-- The loop. -->
    <template v-else-if="phase === 'question' && item">
      <div class="safe-px mx-auto grid w-full max-w-3xl flex-1 content-start gap-3 py-4 pb-36">
        <NarrationBar :item="item" :reveal="reveal" :label="`Question ${position + 1} of ${total}`" />
        <QuestionCard :key="item.id" :item="item" :answered="chosen" :reveal="reveal" class="anim-deal-in" @choose="choose" />
      </div>

      <div class="safe-pb fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/92 backdrop-blur-xl">
        <div class="safe-px mx-auto flex max-w-3xl items-center gap-3 py-3.5">
          <AppButton
            variant="primary"
            size="lg"
            block
            :disabled="!reveal"
            :loading="busy && reveal"
            :icon-right="isLast ? 'check' : 'arrow-right'"
            @click="advance"
          >{{ !reveal ? 'Pick an answer' : isLast ? 'Finish round' : 'Continue' }}</AppButton>

          <p class="hidden shrink-0 text-[11.5px] font-bold text-muted sm:block">
            <template v-if="reveal">press <kbd class="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-sans">Enter</kbd></template>
            <template v-else>press <kbd class="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-sans">1</kbd>–<kbd class="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-sans">4</kbd></template>
          </p>
        </div>
      </div>
    </template>

    <!-- Scheduling the first batch. -->
    <div v-else class="safe-px mx-auto grid w-full max-w-3xl flex-1 content-start gap-3 py-4">
      <Skeleton height="3rem" />
      <Skeleton height="22rem" />
    </div>
  </div>
</template>
