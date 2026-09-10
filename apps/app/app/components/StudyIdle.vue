<script setup lang="ts">
import { JURISDICTIONS } from "@rep/schema";
import type { IconName } from "./Icon.vue";
import type { StartPracticeOptions } from "~/composables/useStudy";
/**
 * What the loop shows when it cannot schedule a batch.
 *
 * "Nothing to do" is the moment a study app feels broken, so this screen never just says so. It
 * works out *why* the queue is empty — spaced repetition is holding everything back, the state bank
 * is still thin, only leeches are left, or the free allowance is spent — and then answers the two
 * questions the learner actually has: how am I doing, and what can I do right now.
 *
 * Every route out of here is a real one; there is no branch that renders only a headline.
 */
const props = withDefaults(defineProps<{
  /** Nothing is loaded yet and the learner has not asked for a session: offer to start one. */
  ready?: boolean;
  /** A practice session is in flight (server-side) and can be continued. */
  canResume?: boolean;
}>(), { ready: false, canResume: false });
const emit = defineEmits<{ (e: "start", opts: StartPracticeOptions): void; (e: "resume"): void; (e: "menu"): void; (e: "change-state"): void }>();

const study = useStudy();
const studyState = useStudyState();
const content = useContent();
const coverage = useCoverage();
const readiness = useReadiness();
const freeTier = useFreeTier();
const entitlement = useEntitlement();
const plan = usePlan();

const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);
const stateName = computed(() => (jur.value ? JURISDICTIONS[jur.value as keyof typeof JURISDICTIONS] ?? jur.value : "your state"));
const status = computed(() => (jur.value ? content.manifest.value?.status?.[jur.value] ?? null : null));

/**
 * With no answers the Beta prior lands on exactly 50%, which reads as a real estimate and would sit
 * directly above a caption saying readiness has not started yet. `answersUsed > 0` is the same gate
 * ReadinessCard uses, so a dash means "no signal" everywhere in the app.
 */
const nat = computed(() => (readiness.national.value?.answersUsed ? readiness.national.value : null));
const st = computed(() => (readiness.state.value?.answersUsed ? readiness.state.value : null));

const pipe = computed(() => coverage.pipeline.value);
const seen = computed(() => pipe.value.red + pipe.value.yellow + pipe.value.green);
/** The state bank has nothing to draw from, so only the national portion can be practised. */
const stateBankThin = computed(() => {
  const rows = coverage.state.value;
  return !rows || rows.every((r) => r.bankItems === 0);
});

const nationalBank = ref<string | null>(null);
const nextDue = ref<number | null>(null);
const tick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  nationalBank.value = (await study.banks()).national;
  nextDue.value = await study.nextDueAt();
  timer = setInterval(() => (tick.value = Date.now()), 30_000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });

/** "in 40 minutes" / "in 6 hours" / "tomorrow" / "in 3 days" — coarse on purpose. */
const dueIn = computed(() => {
  if (nextDue.value == null) return null;
  const ms = nextDue.value - tick.value;
  if (ms <= 0) return "any moment";
  const mins = Math.round(ms / 60_000);
  if (mins < 90) return `in ${Math.max(1, mins)} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.round(ms / 3_600_000);
  if (hrs < 36) return `in ${hrs} hour${hrs === 1 ? "" : "s"}`;
  const days = Math.round(ms / 86_400_000);
  return days === 1 ? "tomorrow" : `in ${days} days`;
});

/**
 * The four situations, in the order that matters. Free tier first because it is the only one the
 * learner cannot resolve by studying differently.
 */
/**
 * Practice is always available. The only thing that can genuinely stop a learner is the free-tier
 * allowance; everything else is just what to show first.
 *
 * There used to be a "scheduled" state that said "You are caught up — the next batch comes back in
 * 33 hours" and offered no way to practise. Spaced repetition is a good reason to ORDER questions,
 * not a reason to refuse to show any, and being told to come back tomorrow reads as the app being
 * broken. The schedule still decides what comes first (see fn_batch_candidates); it no longer
 * decides whether anything comes at all.
 */
const reason = computed<"ready" | "free" | "leeches" | "thin">(() => {
  if (freeTier.applies.value && freeTier.exhausted.value) return "free";
  if (pipe.value.leeches > 0 && pipe.value.unseen === 0 && seen.value > 0) return "leeches";
  if (stateBankThin.value && seen.value === 0) return "thin";
  return "ready";
});

const headline = computed(() => ({
  ready: props.canResume ? "Pick up where you left off" : "Ready to practise?",
  free: "That is your free allowance",
  leeches: "Only your hardest questions are left",
  thin: `The ${stateName.value} bank is still filling`,
}[reason.value]));

const blurb = computed(() => ({
  ready: "Practice shows one question at a time. After each answer you see whether you were right, the explanation, and the statute it rests on. Nothing is timed.",
  free: `You have answered all ${freeTier.total} free questions. Complete opens every state, both national banks, full mocks and the audio narration — once, and forever.`,
  leeches: "The questions you have missed four or more times are kept out of normal rounds so they cannot crowd out everything else. They get their own focused drill.",
  thin: `More questions for ${stateName.value} arrive as they are written and verified. You can practise everything that is already here, and the national portion is the larger half of your exam.`,
}[reason.value]));

interface Action { key: string; label: string; hint: string; icon: IconName; tone: "primary" | "secondary"; run: () => void }

const actions = computed<Action[]>(() => {
  const out: Action[] = [];
  const nb = nationalBank.value;

  if (reason.value === "free") {
    out.push({ key: "buy", label: "Unlock Complete", hint: "Everything, one payment", icon: "spark", tone: "primary", run: () => { void navigateTo("/pricing"); } });
    out.push({ key: "review", label: "Review what you answered", hint: "Your free questions stay yours", icon: "refresh", tone: "secondary", run: () => { void navigateTo("/app/review"); } });
    return out;
  }

  // Practice is offered in every state except an exhausted free tier: there is always something to
  // answer while the bank has questions in it.
  if (props.canResume) out.push({ key: "resume", label: "Continue your session", hint: "Your unfinished practice questions", icon: "play", tone: "primary", run: () => emit("resume") });
  out.push({ key: "practice", label: props.canResume ? "Start a new practice session" : "Start a practice session", hint: "Due reviews mixed with the rest of the bank", icon: "play", tone: props.canResume ? "secondary" : "primary", run: () => emit("start", {}) });

  if (pipe.value.leeches > 0) {
    out.push({
      key: "drill",
      label: `Drill ${pipe.value.leeches} hard question${pipe.value.leeches === 1 ? "" : "s"}`,
      hint: "The ones you keep missing",
      icon: "target",
      tone: reason.value === "leeches" ? "primary" : "secondary",
      run: () => emit("start", { kind: "drill" }),
    });
  }

  if (stateBankThin.value && nb) {
    out.push({ key: "national", label: "Practise the national portion", hint: "Ready for every state", icon: "play", tone: "secondary", run: () => emit("start", { banks: [nb] }) });
  }

  out.push({ key: "mock", label: "Sit a timed mock", hint: "Your exam's real format and length", icon: "clock", tone: "secondary", run: () => { void navigateTo("/app/mocks"); } });
  if (stateBankThin.value && entitlement.isComplete.value) {
    out.push({ key: "state", label: "Study a different state", hint: "Switch your jurisdiction", icon: "map", tone: "secondary", run: () => emit("change-state") });
  } else {
    out.push({ key: "glossary", label: "Read the glossary", hint: "Terms with the law behind them", icon: "book", tone: "secondary", run: () => { void navigateTo("/app/glossary"); } });
  }

  return out;
});

const primary = computed(() => actions.value.find((a) => a.tone === "primary") ?? actions.value[0]);
const rest = computed(() => actions.value.filter((a) => a !== primary.value));
</script>
<template>
  <div class="safe-px anim-fade-up mx-auto grid w-full max-w-xl gap-5 py-8">
    <!-- why you are here, said plainly -->
    <div class="text-center">
      <span
        class="mx-auto grid size-16 place-items-center rounded-full"
        :class="reason === 'free' ? 'bg-accent-soft text-accent' : reason === 'ready' ? 'bg-ok-soft text-ok' : 'bg-surface-2 text-ink-2'"
      >
        <Icon :name="reason === 'ready' ? 'play' : reason === 'free' ? 'spark' : reason === 'leeches' ? 'target' : 'book'" :size="30" />
      </span>
      <h1 class="display mt-3.5 text-[24px]">{{ headline }}</h1>
      <p class="mx-auto mt-2 max-w-[44ch] text-[14.5px] leading-relaxed text-ink-2">{{ blurb }}</p>
    </div>

    <!-- the next thing to do, as one obvious button -->
    <div v-if="primary" class="grid gap-2">
      <AppButton variant="primary" size="lg" block :icon="primary.icon" @click="primary.run()">{{ primary.label }}</AppButton>
      <p class="text-center text-[12.5px] font-bold text-muted">{{ primary.hint }}</p>
    </div>

    <!-- how you are actually doing: the same numbers the Progress screen reports -->
    <div class="rounded-card border border-line bg-surface p-4 shadow-card">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <p class="eyebrow">National</p>
          <p class="tabular mt-1 text-[26px] font-extrabold leading-none">
            <template v-if="nat">{{ nat.expectedPct.toFixed(0) }}<span class="text-[16px] text-muted">%</span></template>
            <template v-else>—</template>
          </p>
        </div>
        <div>
          <p class="eyebrow">State</p>
          <p class="tabular mt-1 text-[26px] font-extrabold leading-none">
            <template v-if="st">{{ st.expectedPct.toFixed(0) }}<span class="text-[16px] text-muted">%</span></template>
            <template v-else>—</template>
          </p>
        </div>
      </div>

      <div v-if="seen > 0" class="mt-4 border-t border-line pt-4">
        <p class="eyebrow mb-2.5">Your boxes</p>
        <PipelineBar :p="pipe" />
      </div>
      <p v-else class="mt-4 border-t border-line pt-4 text-[13px] leading-relaxed text-muted">
        Readiness appears once you have answered enough questions for the estimate to mean something.
        Only answers count — reading a question never moves it.
      </p>

      <div v-if="plan.plan.value && plan.plan.value.daysLeft != null" class="tabular mt-3.5 flex items-center gap-2 text-[13px] font-bold text-muted">
        <Icon name="calendar" :size="15" />
        <span>{{ plan.plan.value.daysLeft }} days to your exam · {{ plan.plan.value.dailyTarget }} questions a day keeps you on pace</span>
      </div>
    </div>

    <!-- the state's own progress, when that is what is holding things up -->
    <div v-if="reason === 'thin' && status" class="rounded-card border border-line bg-surface p-4 shadow-card">
      <div class="flex items-baseline justify-between gap-3">
        <p class="text-[14.5px] font-extrabold">{{ stateName }} bank</p>
        <p class="tabular text-[13px] font-bold text-muted">{{ status.published }} / {{ status.target }} published</p>
      </div>
      <div class="mt-2.5 h-2 overflow-hidden rounded-pill bg-surface-3">
        <span class="block h-full rounded-pill bg-accent transition-[width] duration-500 ease-emphasized" :style="{ width: Math.min(100, status.target ? (100 * status.published) / status.target : 0) + '%' }" />
      </div>
      <p class="mt-2.5 text-[12.5px] text-muted">
        {{ status.verified }} verified against the statute · {{ status.mocks }} mock form{{ status.mocks === 1 ? '' : 's' }} ready
      </p>
    </div>

    <!-- everything else worth doing, as rows rather than a wall of buttons -->
    <div v-if="rest.length" class="grid gap-2">
      <button
        v-for="a in rest"
        :key="a.key"
        type="button"
        class="flex min-h-[3.75rem] items-center gap-3.5 rounded-card border border-line bg-surface p-3.5 text-left shadow-card
               transition-[transform,border-color] duration-150 ease-standard hover:border-line-strong active:scale-[0.99]"
        @click="a.run()"
      >
        <span class="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2"><Icon :name="a.icon" :size="19" /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-[14.5px] font-extrabold leading-tight">{{ a.label }}</span>
          <span class="block truncate text-[12.5px] text-muted">{{ a.hint }}</span>
        </span>
        <Icon name="chevron-right" :size="17" class="shrink-0 text-muted" />
      </button>
    </div>

    <FreeTierGate v-if="reason !== 'free'" variant="banner" />
    <GuaranteeOffer variant="row" />

    <button type="button" class="mx-auto text-[13px] font-bold text-muted underline-offset-4 hover:text-ink hover:underline" @click="emit('menu')">
      Open the menu
    </button>
  </div>
</template>
