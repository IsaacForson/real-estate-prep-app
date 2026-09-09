<script setup lang="ts">
import { pushToast } from "~/components/Toast.vue";
import { passItemsFrom } from "~~/lib/study/readiness";
import type { StudySession } from "~~/lib/study/types";
/** Mocks: available forms, resume in-progress, results history. */
useHead({ title: "Mocks" });
const studyState = useStudyState();
const study = useStudy();
const content = useContent();
const entitlement = useEntitlement();
const free = useFreeTier();
const events = useEvents();

const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);
const st = computed(() => (jur.value ? content.manifest.value?.states?.[jur.value] ?? null : null));
const exam = computed(() => (studyState.settings.value?.licenseLevel === "broker" && st.value?.broker_exam ? { ...st.value.salesperson_exam, ...st.value.broker_exam } : st.value?.salesperson_exam) ?? null);
const mockForms = useMockForms();
const nationalBank = computed(() => (st.value?.vendor === "psi" ? "national_psi" : st.value?.vendor === "pearsonvue" ? "national_pearsonvue" : null));
/** Published full-length forms for this learner: the state's own first, then the vendor's national forms. */
const publishedFull = computed(() => [...mockForms.forState(jur.value), ...mockForms.national(nationalBank.value)].filter((f) => f.form_id !== "short"));
const formsAvailable = computed(() => publishedFull.value.length);
const complete = computed(() => entitlement.isComplete.value);
const active = computed(() => study.activeSession.value?.kind === "mock" ? study.activeSession.value : null);
const history = computed<StudySession[]>(() => (study.history.value ?? []).filter((s) => s.kind === "mock" && !!s.endedAt));
const busy = ref<string | null>(null);
const confirmForm = ref<string | null>(null);

const forms = computed(() => {
  const list: Array<{ id: string; title: string; detail: string; locked: boolean; short?: boolean }> = [];
  if (!complete.value) list.push({ id: "short", title: "Short mock (free)", detail: `${20} questions in your exam's proportions, timed proportionally`, locked: free.mocksRemaining.value <= 0, short: true });
  const n = Math.max(formsAvailable.value, 5);
  for (let i = 1; i <= n; i++) list.push({ id: publishedFull.value[i - 1]?.form_id ?? `form-${i}`, title: `Form ${i}`, detail: i <= formsAvailable.value ? "Full length · non-overlapping" : "Arrives as this state's bank fills", locked: !complete.value || i > formsAvailable.value });
  return list;
});
const timeLabel = computed(() => (exam.value?.time_minutes ? `${exam.value.time_minutes} min` : "—"));

async function start(formId: string) {
  confirmForm.value = null; busy.value = formId;
  try {
    const s = await study.startMock(formId);
    if (!s || !s.itemIds.length) { pushToast("Not enough questions in this state's bank yet to build that form.", "warn"); return; }
    events.track("mock_start", { form: formId });
    await navigateTo("/app/mocks/run");
  } finally { busy.value = null; }
}
async function resume() { if (!active.value) return; await study.resume(active.value.id); await navigateTo("/app/mocks/run"); }
function scoreOf(s: StudySession) {
  const a = Object.values(s.answers); const c = a.filter((x) => x.correct).length;
  const portions = (s.portions ?? []).map((p) => { const pc = p.itemIds.filter((id) => s.answers[id]?.correct).length; const need = passItemsFrom(p.passScore, p.itemIds.length); return { ...p, correct: pc, need, pass: need == null ? null : pc >= need }; });
  const pass = portions.length ? portions.every((p) => p.pass !== false) : null;
  return { c, n: s.itemIds.length, pct: s.itemIds.length ? Math.round((100 * c) / s.itemIds.length) : 0, pass, portions };
}
const fmt = (t: number | null) => (t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
onMounted(() => { void content.load().then(() => mockForms.load(jur.value, nationalBank.value)); void free.load(); void study.loadHistory(50); });
watch([jur, nationalBank], () => { void mockForms.load(jur.value, nationalBank.value); });
</script>
<template>
  <div class="grid w-full gap-4 text-ink">
    <p class="text-[13.5px] leading-relaxed text-ink-2">Timed forms in your state's exam format. Answers stay hidden until you submit.</p>
    <AppCard v-if="active" tone="accent">
      <div class="flex items-center gap-3">
        <span class="grid size-11 shrink-0 place-items-center rounded-card bg-accent text-accent-ink">
          <Icon name="clock" :size="21" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-[15px] font-semibold leading-tight">Mock in progress</p>
          <p class="tabular text-[13px] text-ink-2">
            {{ Object.keys(active.answers).length }} of {{ active.itemIds.length }} answered · timer keeps running
          </p>
        </div>
        <AppButton variant="primary" size="sm" icon-right="arrow-right" @click="resume">Resume</AppButton>
      </div>
    </AppCard>

    <AppCard
      v-if="exam"
      :title="`${st?.name ?? jur} exam format`"
      :subtitle="`Every form mirrors it. Pass: ${exam.grading === 'separate' ? `${exam.pass_score_national ?? '—'} national · ${exam.pass_score_state ?? '—'} state` : (exam.pass_score_combined ?? exam.pass_score_national ?? '—')}.`"
    >
      <div class="grid grid-cols-3 gap-2">
        <StatTile label="National" :value="exam.national_items ?? '—'" hint="questions" />
        <StatTile label="State" :value="exam.state_items ?? exam.total_items ?? '—'" hint="questions" />
        <StatTile label="Time" :value="timeLabel" :hint="exam.grading === 'separate' ? 'graded separately' : 'one score'" />
      </div>
      <p v-if="exam.calculator_policy" class="mt-3.5 text-[12px] text-muted">Calculator: {{ exam.calculator_policy }}</p>
    </AppCard>

    <AppCard v-else-if="!jur">
      <EmptyState icon="map" title="Choose your state" body="Mocks are built to your state's exact format. Pick a state from the menu first." compact>
        <AppButton to="/app" variant="primary" size="sm">Go to Home</AppButton>
      </EmptyState>
    </AppCard>

    <AppCard title="Forms" padding="none">
      <ul>
        <li v-for="f in forms" :key="f.id" class="flex min-h-16 items-center gap-3 border-b border-line px-4 last:border-b-0">
          <span
            class="tabular grid size-9 shrink-0 place-items-center rounded-lg text-[13px] font-semibold"
            :class="f.locked ? 'bg-surface-2 text-muted' : 'bg-accent-soft text-accent'"
          >
            <Icon v-if="f.locked" name="lock" :size="15" />
            <template v-else>{{ f.short ? 'S' : f.id.replace('form-', '') }}</template>
          </span>

          <div class="min-w-0 flex-1 py-2">
            <p class="text-[15px] font-medium leading-snug">{{ f.title }}</p>
            <p class="mt-0.5 text-[12px] leading-snug text-muted">{{ f.detail }}</p>
          </div>

          <AppButton v-if="!f.locked" size="sm" :variant="f.short ? 'primary' : 'secondary'" :loading="busy === f.id" :disabled="!!active" @click="confirmForm = f.id">Start</AppButton>
          <AppButton v-else-if="!complete && !f.short" size="sm" variant="soft" to="/pricing">Unlock</AppButton>
          <Badge v-else tone="outline">{{ f.short ? 'used' : 'soon' }}</Badge>
        </li>
      </ul>
      <p v-if="!complete" class="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-muted">
        Complete includes five full-length, non-overlapping forms per state in your exam's exact format
        and timing — $59 once.
      </p>
    </AppCard>

    <AppCard title="Results" padding="none">
      <ul v-if="history.length">
        <li v-for="s in history" :key="s.id" class="grid gap-2 border-b border-line px-4 py-3.5 last:border-b-0">
          <div class="flex items-center gap-3">
            <span
              class="tabular text-[19px] font-semibold tracking-[-0.02em]"
              :class="scoreOf(s).pass == null ? '' : scoreOf(s).pass ? 'text-ok' : 'text-danger'"
            >{{ scoreOf(s).pct }}%</span>
            <span class="tabular min-w-0 flex-1 truncate text-[13.5px] text-ink-2">
              {{ scoreOf(s).c }}/{{ scoreOf(s).n }} ·
              {{ s.mockFormId === 'short' ? 'Short mock' : s.mockFormId?.replace('form-', 'Form ') ?? 'Mock' }}
            </span>
            <Badge v-if="scoreOf(s).pass != null" :tone="scoreOf(s).pass ? 'ok' : 'danger'">{{ scoreOf(s).pass ? 'pass' : 'below' }}</Badge>
            <span class="tabular shrink-0 text-[12px] text-muted">{{ fmt(s.endedAt) }}</span>
          </div>

          <div v-if="scoreOf(s).portions.length > 1" class="tabular flex flex-wrap gap-x-3.5 text-[12px] text-muted">
            <span v-for="p in scoreOf(s).portions" :key="p.portion" class="capitalize">
              {{ p.portion }} {{ p.correct }}/{{ p.itemIds.length }}<template v-if="p.need != null"> ({{ p.need }} needed)</template>
            </span>
          </div>
        </li>
      </ul>
      <EmptyState
        v-else
        icon="trophy"
        title="No mocks finished yet"
        body="Finished mocks land here with a pass/below verdict per portion. Five mocks is what predicts passing."
        compact
      />
    </AppCard>

    <AppSheet
      :open="!!confirmForm"
      title="Start the timed mock?"
      description="The clock starts now and keeps running if you leave. You can resume from Home."
      @close="confirmForm = null"
    >
      <div class="grid gap-2.5">
        <p class="text-[13.5px] leading-relaxed text-ink-2">
          Answers don't show feedback during a mock. Your boxes update when you submit.
        </p>
        <AppButton variant="primary" size="lg" block icon="play" @click="start(confirmForm!)">Start</AppButton>
        <AppButton variant="ghost" size="lg" block @click="confirmForm = null">Not now</AppButton>
      </div>
    </AppSheet>
  </div>
</template>
