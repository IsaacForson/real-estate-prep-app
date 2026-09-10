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
const readiness = useReadiness();
const coverage = useCoverage();

/**
 * What to sit. A mock used to be whichever fixed `mock_forms` row existed, which meant the same
 * questions every time and no way to sit only the state or only the national portion. A generated
 * mock is drawn at random from the chosen scope and timed at the exam's own per-question rate, so
 * "another mock" is genuinely another mock.
 */
const portion = ref<"both" | "national" | "state">("both");
const portionTabs = computed(() => [
  { value: "both", label: "Full exam" },
  { value: "national", label: "National" },
  { value: "state", label: jur.value ?? "State" },
]);
const portionBanks = computed(() => {
  const nb = nationalBank.value, sb = jur.value ? `state_${jur.value}` : null;
  if (portion.value === "national") return [nb].filter((b): b is string => !!b);
  if (portion.value === "state") return [sb].filter((b): b is string => !!b);
  return [nb, sb].filter((b): b is string => !!b);
});
const portionReadiness = computed(() => (portion.value === "national" ? readiness.national.value : portion.value === "state" ? readiness.state.value : null));
/** Sections of the chosen portion, so a mock can be sat on one topic. */
const sections = computed(() => ((portion.value === "national" ? coverage.national.value : portion.value === "state" ? coverage.state.value : []) ?? []));
/** How many questions a generated mock should hold for the current choice. */
const generatedSize = computed(() => {
  const n = needNational.value, st = needState.value;
  const want = portion.value === "national" ? n : portion.value === "state" ? st : n + st;
  const have = portion.value === "national" ? nationalAvailable.value : portion.value === "state" ? stateAvailable.value : availableTotal.value;
  return Math.max(1, Math.min(want || have, have));
});
/** Minutes per question from the real exam, so a shorter mock is timed proportionally. */
const msPerQuestion = computed(() => {
  const mins = exam.value?.time_minutes ?? null;
  const total = (needNational.value + needState.value) || null;
  return mins && total ? (mins * 60_000) / total : 90_000;
});

async function startGenerated(node?: string) {
  const banks = portionBanks.value;
  if (!banks.length) { pushToast("Choose your state first.", "info"); return; }
  busy.value = node ?? `gen-${portion.value}`;
  try {
    const picked: string[] = [];
    const perBank: Array<{ portion: "national" | "state"; bank: string; itemIds: string[] }> = [];
    for (const b of banks) {
      const ids = await study.source.ids(b);
      let pool = ids;
      if (node) {
        const its = await study.getItems(ids);
        pool = its.filter((i) => i.blueprint_node === node || i.blueprint_node.startsWith(`${node}.`)).map((i) => i.id);
      }
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const share = node ? shuffled.length : Math.round(generatedSize.value * (banks.length === 1 ? 1 : (b === nationalBank.value ? needNational.value : needState.value) / Math.max(1, needNational.value + needState.value)));
      const take = shuffled.slice(0, Math.max(0, Math.min(share || shuffled.length, shuffled.length)));
      if (!take.length) continue;
      picked.push(...take);
      perBank.push({ portion: b === nationalBank.value ? "national" : "state", bank: b, itemIds: take });
    }
    if (!picked.length) { pushToast(node ? "No questions in this section yet." : "No questions in this scope yet.", "info"); return; }
    const passFor = (p: "national" | "state") => (p === "national" ? exam.value?.pass_score_national ?? exam.value?.pass_score_combined ?? null : exam.value?.pass_score_state ?? exam.value?.pass_score_combined ?? null);
    await study.startSession("mock", {
      banks,
      itemIds: picked,
      timeLimitMs: Math.round(picked.length * msPerQuestion.value),
      mockFormId: node ? `section-${node}` : `${portion.value}-${Date.now().toString(36)}`,
      portions: perBank.map((x) => ({ portion: x.portion, bank: x.bank, itemIds: x.itemIds, passScore: passFor(x.portion) == null ? null : String(passFor(x.portion)) })),
    });
    events.track("mock_start", { form: node ? `section-${node}` : portion.value, items: picked.length });
    await navigateTo("/app/mocks/run");
  } finally { busy.value = null; }
}
const nationalBank = computed(() => (st.value?.vendor === "psi" ? "national_psi" : st.value?.vendor === "pearsonvue" ? "national_pearsonvue" : null));
/** Published full-length forms for this learner: the state's own first, then the vendor's national forms. */
const publishedFull = computed(() => [...mockForms.forState(jur.value), ...mockForms.national(nationalBank.value)].filter((f) => f.form_id !== "short"));
const formsAvailable = computed(() => publishedFull.value.length);
/**
 * Whether a form can actually be built, not just whether a mock_forms row exists.
 *
 * A published row is a national one, so Forms 1 and 2 showed a Start button in every state — and
 * tapping it failed with "not enough questions in this state's bank" because a full form also needs
 * the state portion (Arizona: 80 national + 60 state, against 34 state items). Offering a button
 * that cannot work is worse than showing the form as still filling.
 *
 * Counts come from the manifest, and provisional (`verified`) items count because publish ships
 * them alongside `qa_approved` ones — using `published` alone would under-report the live bank.
 */
const bankCount = (s?: { verified: number; published: number } | null) => (s ? s.verified + s.published : 0);
const stateAvailable = computed(() => (jur.value ? bankCount(content.manifest.value?.status?.[jur.value]) : 0));
const nationalAvailable = computed(() => (nationalBank.value ? bankCount(content.manifest.value?.nationalStatus?.[nationalBank.value]) : 0));
const needState = computed(() => exam.value?.state_items ?? exam.value?.total_items ?? 0);
const needNational = computed(() => exam.value?.national_items ?? 0);
const MIN_MOCK_ITEMS = 1;
const availableTotal = computed(() => stateAvailable.value + nationalAvailable.value);
const neededTotal = computed(() => needState.value + needNational.value);
const canBuildFull = computed(() => stateAvailable.value >= needState.value && nationalAvailable.value >= needNational.value);
/** A mock is worth sitting once the banks can fill a real one; below that it is a quiz. */
const canBuildMock = computed(() => availableTotal.value >= MIN_MOCK_ITEMS);
/** What a form would actually be right now, so the row never claims a length it cannot deliver. */
const formLength = computed(() => Math.min(availableTotal.value, neededTotal.value));
const complete = computed(() => entitlement.isComplete.value);
const active = computed(() => study.activeSession.value?.kind === "mock" ? study.activeSession.value : null);
/**
 * Finished mocks worth showing. A session with no answers is one that was opened and abandoned —
 * listing it as "0%" reads as a failed attempt and buried the real results under rows like
 * "0% 0/98 · full".
 */
const history = computed<StudySession[]>(() => (study.history.value ?? []).filter((s) => s.kind === "mock" && !!s.endedAt && Object.keys(s.answers ?? {}).length > 0));
const busy = ref<string | null>(null);
const confirmForm = ref<string | null>(null);

const forms = computed(() => {
  const list: Array<{ id: string; title: string; detail: string; locked: boolean; short?: boolean }> = [];
  if (!complete.value) list.push({ id: "short", title: "Short mock (free)", detail: `${20} questions in your exam's proportions, timed proportionally`, locked: free.mocksRemaining.value <= 0 || !canBuildMock.value, short: true });
  const n = Math.max(formsAvailable.value, 5);
  const full = canBuildFull.value;
  // Every form is sittable while the bank has questions in it. A form that is shorter than the real
  // exam says so plainly instead of being locked: a learner would rather sit 35 questions now than
  // be told to come back when the bank is finished.
  const sittable = canBuildMock.value;
  for (let i = 1; i <= n; i++) {
    list.push({
      id: publishedFull.value[i - 1]?.form_id ?? `form-${i}`,
      title: `Form ${i}`,
      detail: !sittable
        ? "Arrives as this state's bank fills"
        : full || formLength.value >= neededTotal.value
          ? "Full length · non-overlapping"
          : `${formLength.value} of ${neededTotal.value} questions so far · more arrive as the bank fills`,
      locked: !complete.value || !sittable,
    });
  }
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
  // `p.pass` is null when the portion has no stated pass score. Treating null as "not false" made
  // every such mock read "pass" — including 0% ones — so a verdict now needs every portion to have
  // actually passed, and any failed portion fails the form. Unknown stays unknown.
  const verdicts = portions.map((p) => p.pass);
  const pass = verdicts.some((v) => v === false)
    ? false
    : verdicts.length > 0 && verdicts.every((v) => v === true)
      ? true
      : null;
  return { c, n: s.itemIds.length, pct: s.itemIds.length ? Math.round((100 * c) / s.itemIds.length) : 0, pass, portions };
}
const fmt = (t: number | null) => (t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
onMounted(() => { void coverage.refresh(); void readiness.refresh?.(); void content.load().then(() => mockForms.load(jur.value, nationalBank.value)); void free.load(); void study.loadHistory(50); });
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

    <AppCard title="Sit a mock">
      <AppTabs v-model="portion" :tabs="portionTabs" aria-label="What to sit" class="mb-4" />

      <div class="grid grid-cols-2 gap-3">
        <StatTile label="Questions" :value="generatedSize" hint="drawn at random" />
        <StatTile
          label="Readiness"
          :value="portionReadiness ? `${portionReadiness.expectedPct.toFixed(0)}%` : '—'"
          :hint="portion === 'both' ? 'per portion below' : 'predicted score'"
        />
      </div>

      <AppButton
        class="mt-4"
        variant="primary"
        size="lg"
        block
        icon="clock"
        :loading="busy === `gen-${portion}`"
        :disabled="!portionBanks.length"
        @click="startGenerated()"
      >Start a timed mock</AppButton>
      <p class="mt-2 text-center text-[12.5px] text-muted">
        A new random draw every time, timed at your exam's own rate. Answers stay hidden until you submit.
      </p>

      <div v-if="sections.length" class="mt-5 border-t border-line pt-4">
        <p class="eyebrow mb-2">Or sit one section</p>
        <ul class="-mx-1 grid gap-0.5">
          <li v-for="sec in sections" :key="sec.node">
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-3 rounded-card px-2.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-50"
              :disabled="busy === sec.node"
              @click="startGenerated(sec.node)"
            >
              <span class="tabular grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-[12px] font-semibold text-ink-2">{{ sec.node }}</span>
              <span class="min-w-0 flex-1 truncate text-[14px]">{{ sec.label }}</span>
              <Icon name="chevron-right" :size="16" class="shrink-0 text-muted" />
            </button>
          </li>
        </ul>
      </div>
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
