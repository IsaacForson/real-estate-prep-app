<script setup lang="ts">
import { JURISDICTIONS } from "@rep/schema";
import { pushToast } from "~/components/Toast.vue";
/** Home: readiness, today's plan, continue, coverage summary, exam countdown. */
useHead({ title: "Home" });
const auth = useAuth();
const studyState = useStudyState();
const study = useStudy();
const readiness = useReadiness();
const coverage = useCoverage();
const planApi = usePlan();
const entitlement = useEntitlement();
const content = useContent();

const picker = ref(false);
const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);
const examDate = computed(() => studyState.settings.value?.examDate ?? null);
const daysLeft = computed(() => examDate.value ? Math.ceil((new Date(examDate.value + "T00:00").getTime() - Date.now()) / 86_400_000) : null);
const active = computed(() => study.activeSession.value);
const headline = computed(() => readiness.state.value ?? readiness.national.value ?? null);
const stateName = computed(() => (jur.value ? JURISDICTIONS[jur.value as keyof typeof JURISDICTIONS] ?? jur.value : null));
const stateRows = computed(() => coverage.state.value ?? []);
const nationalRows = computed(() => coverage.national.value ?? []);
const weakest = computed(() => [...stateRows.value, ...nationalRows.value].filter((r) => r.solidItems != null).sort((a, b) => (a.solidItems! / a.examItems) - (b.solidItems! / b.examItems)).slice(0, 3));
const firstName = computed(() => auth.user.value?.email?.split("@")[0] ?? "");
const greeting = computed(() => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; });

async function chooseState(code: string) {
  picker.value = false;
  await studyState.set({ jurisdiction: code });
  pushToast(`Studying ${JURISDICTIONS[code as keyof typeof JURISDICTIONS] ?? code}`, "ok");
}
async function setExamDate(date: string | null) { await studyState.set({ examDate: date }); }
async function startPractice() {
  const s = await study.startPractice({ kind: "practice" });
  if (!s) { pushToast("No questions available right now.", "warn"); return; }
  await navigateTo("/app/study/practice");
}
async function resume() {
  if (!active.value) return;
  await study.resume(active.value.id);
  await navigateTo(active.value.kind === "mock" ? "/app/mocks/run" : "/app/study/practice");
}
onMounted(() => { void content.load(); });
watch(() => [studyState.ready.value, jur.value], ([ready, j]) => { if (ready && !j) picker.value = true; }, { immediate: true });
</script>
<template>
  <div class="grid gap-4 anim-fade-up">
    <div class="flex items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm text-muted">{{ greeting }}<template v-if="firstName">, {{ firstName }}</template></p>
        <button type="button" class="group inline-flex items-center gap-1.5 text-2xl display text-left" @click="picker = true" :aria-label="`Change state, currently ${stateName ?? 'not set'}`">
          {{ stateName ?? 'Choose your state' }}<Icon name="chevron-down" :size="20" class="text-muted group-hover:text-ink mt-1" />
        </button>
      </div>
      <Badge v-if="auth.ready.value" :tone="entitlement.isComplete.value ? 'ok' : 'neutral'" size="md">{{ entitlement.isComplete.value ? 'Complete' : 'Free' }}</Badge>
    </div>

    <FreeTierGate variant="banner" />

    <AppCard v-if="active" tone="accent">
      <div class="flex items-center gap-3">
        <span class="grid place-items-center size-11 rounded-xl bg-accent text-accent-ink shrink-0"><Icon :name="active.kind === 'mock' ? 'clock' : 'book'" :size="22" /></span>
        <div class="flex-1 min-w-0">
          <p class="font-semibold leading-tight">Continue where you left off</p>
          <p class="text-sm text-ink-2 truncate">{{ active.kind === 'mock' ? 'Timed mock' : active.kind === 'drill' ? 'Leech drill' : 'Practice' }} · question {{ active.position + 1 }} of {{ active.itemIds.length }}</p>
        </div>
        <AppButton variant="primary" size="sm" icon-right="arrow-right" @click="resume">Resume</AppButton>
      </div>
    </AppCard>

    <AppCard>
      <ReadinessCard :r="headline" :title="readiness.state.value ? 'State portion readiness' : 'National portion readiness'" />
      <div v-if="readiness.state.value && readiness.national.value && (readiness.state.value.answersUsed + readiness.national.value.answersUsed) > 0" class="mt-4 pt-4 border-t border-line grid grid-cols-2 gap-3 text-sm">
        <div><p class="text-muted text-xs">National</p><p class="font-semibold tabular text-lg">{{ readiness.national.value.expectedPct.toFixed(0) }}%</p></div>
        <div><p class="text-muted text-xs">State</p><p class="font-semibold tabular text-lg">{{ readiness.state.value.expectedPct.toFixed(0) }}%</p></div>
      </div>
      <div class="mt-4 flex gap-2">
        <AppButton variant="primary" block icon="play" @click="startPractice">Practice now</AppButton>
        <AppButton to="/app/mocks" variant="secondary" icon="clock">Mock</AppButton>
      </div>
    </AppCard>

    <div class="grid grid-cols-2 gap-3">
      <StatTile label="Exam date" :value="daysLeft == null ? '—' : daysLeft < 0 ? 'Passed' : `${daysLeft}d`" :hint="examDate ? new Date(examDate + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Set it in the plan'" icon="calendar" :tone="daysLeft != null && daysLeft <= 7 ? 'warn' : 'default'" />
      <StatTile label="Sections solid" :value="`${[...stateRows, ...nationalRows].filter((r) => r.solidItems != null && r.solidItems >= r.examItems * 0.8).length}/${stateRows.length + nationalRows.length || '—'}`" hint="80%+ of exam items" icon="target" to="/app/study" />
    </div>

    <PlanCard :plan="planApi.plan.value" :exam-date="examDate" @set-exam-date="setExamDate" />

    <AppCard title="Where to focus" subtitle="Sections with the least solid ground, across both portions.">
      <CoverageTable v-if="weakest.length" :rows="weakest" />
      <p v-else class="text-sm text-muted">Answer three questions in a section and it shows up here.</p>
      <NuxtLink to="/app/study" class="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent">Full coverage <Icon name="arrow-right" :size="16" /></NuxtLink>
    </AppCard>

    <StatePicker :open="picker" :current="jur" @close="picker = false" @select="chooseState" />
  </div>
</template>
