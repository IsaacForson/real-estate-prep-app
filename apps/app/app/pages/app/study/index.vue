<script setup lang="ts">
import { pushToast } from "~/components/Toast.vue";
/**
 * Progress: readiness per portion, the review pipeline and section-by-section coverage.
 *
 * This is a reading screen, not a hub. The study loop schedules itself, so the only thing you can
 * start from here is a focused batch on one weak section — which then drops you into the loop.
 */
useHead({ title: "Progress" });
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
      if (!itemIds.length) {
        // state section with nothing published yet: run the national portion instead of a dead end
        if (portion.value === "state" && nationalBank.value) {
          const alt = await study.startPractice({ kind, banks: [nationalBank.value] });
          if (alt?.itemIds.length) { events.track("session_start", { kind, bank: nationalBank.value, node: null, fallback_from: bank.value }); await navigateTo("/app/practice"); return; }
        }
        pushToast("No questions in this section yet.", "info"); return;
      }
    }
    let s = await study.startPractice({ kind, banks: [bank.value], itemIds });
    // an empty state bank falls back to the national bank — never an empty session
    if ((!s || !s.itemIds.length) && !itemIds && portion.value === "state" && nationalBank.value) s = await study.startPractice({ kind, banks: [nationalBank.value] });
    if (!s || !s.itemIds.length) {
      if (kind === "drill") pushToast("No leeches yet — nothing to drill.", "info");
      else if (!entitlement.isComplete.value && free.exhausted.value) pushToast("Your free questions are used up.", "warn");
      else pushToast("No questions available for this section yet.", "info");
      return;
    }
    events.track("session_start", { kind, bank: bank.value, node: node ?? null });
    await navigateTo("/app/practice");
  } finally { busy.value = null; }
}
async function setLevel(v: string) { await studyState.set({ licenseLevel: v as "salesperson" | "broker" }); }
onMounted(() => { void content.load(); });
</script>
<template>
  <div class="grid w-full gap-4">
    <FreeTierGate variant="block" />

    <AppCard v-if="active && active.kind !== 'mock'" tone="accent">
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-[15px] font-semibold leading-tight">Session in progress</p>
          <p class="tabular text-[13px] text-ink-2">Question {{ active.position + 1 }} of {{ active.itemIds.length }}</p>
        </div>
        <AppButton variant="primary" size="sm" to="/app/practice" icon-right="arrow-right">Continue</AppButton>
      </div>
    </AppCard>

    <!-- Portion switch, then the level switch under it: one decision at a time, biggest first. -->
    <div class="grid gap-2.5">
      <AppTabs v-model="portion" :tabs="tabs" aria-label="Exam portion" />
      <div class="flex items-center justify-between gap-3 px-0.5">
        <span class="text-[12px] leading-snug text-muted">
          {{ portion === 'state' ? 'Your state\'s licensing law and rules' : 'General principles, weighted to the vendor\'s outline' }}
        </span>
        <AppTabs
          :model-value="level"
          :tabs="[{ value: 'salesperson', label: 'Salesperson' }, { value: 'broker', label: 'Broker' }]"
          aria-label="License level"
          class="!w-auto shrink-0"
          @update:model-value="setLevel"
        />
      </div>
    </div>

    <AppCard>
      <ReadinessCard :r="r" :title="portion === 'state' ? 'State readiness' : 'National readiness'" compact />

      <div v-if="pipeline" class="mt-4 border-t border-line pt-4">
        <p class="eyebrow mb-2.5">Review pipeline</p>
        <PipelineBar :p="pipeline" />
      </div>

      <div class="mt-4 grid grid-cols-[1fr_auto] gap-2">
        <AppButton variant="primary" size="lg" icon="play" :loading="busy === 'practice'" @click="start('practice')">Practice session</AppButton>
        <AppButton variant="secondary" size="lg" icon="target" :loading="busy === 'drill'" aria-label="Leech drill" @click="start('drill')">Drill</AppButton>
      </div>
      <p class="mt-2.5 text-[12px] leading-relaxed text-muted">
        Practice mixes due reviews with unseen questions. Drill focuses on leeches — questions missed
        four or more times.
      </p>
    </AppCard>

    <AppCard title="By exam section" subtitle="Tap a section to practise only that section.">
      <CoverageTable v-if="rows.length" :rows="rows" selectable class="-mx-3" @select="(n) => start('practice', n)" />
      <template v-else>
        <Skeleton v-if="!studyState.ready.value" :lines="4" />
        <EmptyState
          v-else
          icon="map"
          title="No blueprint yet"
          body="This portion's outline isn't loaded. Pick your state from the menu, or check back as content lands."
          compact
        />
      </template>
    </AppCard>

  </div>
</template>
