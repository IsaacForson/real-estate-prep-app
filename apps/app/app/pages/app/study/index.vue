<script setup lang="ts">
import { pushToast } from "~/components/Toast.vue";
/** Study hub: pick a portion/section, start practice or a drill, see boxes and coverage. */
useHead({ title: "Study" });
const studyState = useStudyState();
const study = useStudy();
const readiness = useReadiness();
const coverage = useCoverage();
const content = useContent();
const events = useEvents();
const free = useFreeTier();
const entitlement = useEntitlement();

const portion = ref<"state" | "national">("state");
const busy = ref<string | null>(null);
const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);
const level = computed(() => studyState.settings.value?.licenseLevel ?? "salesperson");
const vendor = computed(() => (jur.value ? content.manifest.value?.states[jur.value]?.vendor : null));
const nationalBank = computed(() => (vendor.value === "psi" ? "national_psi" : vendor.value === "pearsonvue" ? "national_pearsonvue" : null));
const stateBank = computed(() => (jur.value ? `state_${jur.value}` : null));
const bank = computed(() => (portion.value === "state" ? stateBank.value : nationalBank.value));
const rows = computed(() => (portion.value === "state" ? coverage.state.value : coverage.national.value) ?? []);
const r = computed(() => (portion.value === "state" ? readiness.state.value : readiness.national.value) ?? null);
const active = computed(() => study.activeSession.value);
const pipeline = ref<Awaited<ReturnType<typeof study.pipelineFor>> | null>(null);
const tabs = computed(() => [
  { value: "state", label: jur.value ? `${jur.value} state` : "State" },
  { value: "national", label: `National${vendor.value === "psi" ? " · PSI" : vendor.value === "pearsonvue" ? " · Pearson VUE" : ""}` },
]);

async function loadPipeline() { pipeline.value = bank.value ? await study.pipelineFor(bank.value).catch(() => null) : null; }
watch(bank, loadPipeline, { immediate: true });

async function start(kind: "practice" | "drill", node?: string) {
  if (!bank.value) { pushToast("Choose your state first.", "warn"); return; }
  busy.value = node ?? kind;
  try {
    let itemIds: string[] | undefined;
    if (node) {
      // section practice: restrict to items whose blueprint node sits under `node`
      const ids = await study.source.ids(bank.value);
      const items = await study.getItems(ids);
      itemIds = items.filter((i) => i.blueprint_node === node || i.blueprint_node.startsWith(`${node}.`)).map((i) => i.id).sort(() => Math.random() - 0.5).slice(0, studyState.settings.value.sessionSize ?? 20);
      if (!itemIds.length) { pushToast("No questions in this section yet.", "info"); return; }
    }
    const s = await study.startPractice({ kind, banks: [bank.value], itemIds });
    if (!s || !s.itemIds.length) {
      if (kind === "drill") pushToast("No leeches yet — nothing to drill.", "info");
      else if (!entitlement.isComplete.value && free.exhausted.value) pushToast("Your free questions are used up.", "warn");
      else pushToast("No questions available for this section yet.", "info");
      return;
    }
    events.track("session_start", { kind, bank: bank.value, node: node ?? null });
    await navigateTo("/app/study/practice");
  } finally { busy.value = null; }
}
async function setLevel(v: string) { await studyState.set({ licenseLevel: v as "salesperson" | "broker" }); }
onMounted(() => { void content.load(); });
</script>
<template>
  <div class="grid gap-4 anim-fade-up">
    <FreeTierGate variant="block" />

    <AppCard v-if="active && active.kind !== 'mock'" tone="accent">
      <div class="flex items-center gap-3">
        <div class="flex-1 min-w-0"><p class="font-semibold">Session in progress</p><p class="text-sm text-ink-2">Question {{ active.position + 1 }} of {{ active.itemIds.length }}</p></div>
        <AppButton variant="primary" size="sm" to="/app/study/practice" icon-right="arrow-right">Continue</AppButton>
      </div>
    </AppCard>

    <div class="grid gap-2">
      <AppTabs v-model="portion" :tabs="tabs" aria-label="Exam portion" />
      <div class="flex items-center justify-between text-xs text-muted px-1">
        <span>{{ portion === 'state' ? 'Your state\'s licensing law and rules' : 'General principles, weighted to the vendor\'s outline' }}</span>
        <AppTabs :model-value="level" :tabs="[{ value: 'salesperson', label: 'Salesperson' }, { value: 'broker', label: 'Broker' }]" aria-label="License level" class="!w-auto" @update:model-value="setLevel" />
      </div>
    </div>

    <AppCard>
      <ReadinessCard :r="r" :title="portion === 'state' ? 'State readiness' : 'National readiness'" compact />
      <div v-if="pipeline" class="mt-4"><PipelineBar :p="pipeline" /></div>
      <div class="mt-4 grid grid-cols-[1fr_auto] gap-2">
        <AppButton variant="primary" size="lg" icon="play" :loading="busy === 'practice'" @click="start('practice')">Practice session</AppButton>
        <AppButton variant="secondary" size="lg" icon="target" :loading="busy === 'drill'" aria-label="Leech drill" @click="start('drill')">Drill</AppButton>
      </div>
      <p class="mt-2 text-xs text-muted">Practice mixes due reviews with unseen questions. Drill focuses on leeches — questions missed four or more times.</p>
    </AppCard>

    <AppCard title="By exam section" subtitle="Tap a section to practise only that section.">
      <CoverageTable v-if="rows.length" :rows="rows" selectable @select="(n) => start('practice', n)" />
      <template v-else>
        <Skeleton v-if="!studyState.ready.value" :lines="4" />
        <EmptyState v-else icon="map" title="No blueprint yet" body="This portion's outline isn't loaded. Pick your state on Home, or check back as content lands." compact />
      </template>
    </AppCard>

    <AppCard padding="none">
      <ListRow icon="clock" label="Timed mocks" detail="Your exam's exact format and timing" to="/app/mocks" />
      <ListRow icon="list" label="Glossary" detail="Every term with its cited source" to="/app/glossary" />
    </AppCard>
  </div>
</template>
