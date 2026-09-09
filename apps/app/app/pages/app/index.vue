<script setup lang="ts">
import { JURISDICTIONS } from "@rep/schema";
/**
 * Home: the first screen after sign-in. Nothing starts by itself here — it shows how the learner is
 * doing and lays out every section of the app with a plain description, so a beginner knows where to go.
 */
useHead({ title: "Home" });
const auth = useAuth();
const study = useStudy();
const studyState = useStudyState();
const readiness = useReadiness();
const coverage = useCoverage();
const plan = usePlan();
const panel = useAppPanel();

const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);
const stateName = computed(() => (jur.value ? JURISDICTIONS[jur.value as keyof typeof JURISDICTIONS] ?? jur.value : null));
const level = computed(() => (studyState.settings.value?.licenseLevel === "broker" ? "Broker" : "Salesperson"));
const nat = computed(() => (readiness.national.value?.answersUsed ? readiness.national.value : null));
const st = computed(() => (readiness.state.value?.answersUsed ? readiness.state.value : null));
const due = computed(() => coverage.pipeline.value.red + coverage.pipeline.value.yellow);
const rows = computed(() => useAppNav({ due: due.value, includeHome: false }));

const active = computed(() => study.activeSession.value && !study.activeSession.value.endedAt ? study.activeSession.value : null);
const continueTo = computed(() => (active.value?.kind === "mock" ? "/app/mocks/run" : "/app/practice"));
const continueLabel = computed(() => {
  const a = active.value; if (!a) return "";
  const done = Object.keys(a.answers).length;
  return a.kind === "mock" ? `Continue your mock exam · ${done} of ${a.itemIds.length} answered` : `Continue your practice session · ${done} of ${a.itemIds.length} answered`;
});
const firstName = computed(() => auth.user.value?.email?.split("@")[0] ?? null);
</script>
<template>
  <div class="safe-px anim-fade-up mx-auto grid w-full max-w-xl gap-5 py-8">
    <div>
      <p class="eyebrow">Home</p>
      <h1 class="display mt-1 text-[24px]">{{ firstName ? `Welcome back, ${firstName}` : "Welcome back" }}</h1>
      <button type="button" class="mt-1.5 inline-flex items-center gap-1.5 text-[14px] font-bold text-muted hover:text-ink" @click.stop="panel.pickState()">
        <Icon name="map" :size="15" />
        <span>{{ stateName ?? "Choose your state" }} · {{ level }}</span>
        <Icon name="chevron-down" :size="14" />
      </button>
    </div>

    <NuxtLink v-if="active" :to="continueTo" class="flex items-center gap-3.5 rounded-card border border-accent/30 bg-accent-soft p-4 shadow-card transition-transform active:scale-[0.99]">
      <span class="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink"><Icon name="play" :size="20" /></span>
      <span class="min-w-0 flex-1">
        <span class="block text-[15.5px] font-extrabold leading-tight">{{ continueLabel }}</span>
        <span class="block text-[12.5px] text-muted">Pick up exactly where you stopped</span>
      </span>
      <Icon name="chevron-right" :size="18" class="shrink-0 text-muted" />
    </NuxtLink>

    <div class="rounded-card border border-line bg-surface p-4 shadow-card">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <p class="eyebrow">National readiness</p>
          <p class="tabular mt-1 text-[26px] font-extrabold leading-none">
            <template v-if="nat">{{ nat.expectedPct.toFixed(0) }}<span class="text-[16px] text-muted">%</span></template>
            <template v-else>—</template>
          </p>
        </div>
        <div>
          <p class="eyebrow">State readiness</p>
          <p class="tabular mt-1 text-[26px] font-extrabold leading-none">
            <template v-if="st">{{ st.expectedPct.toFixed(0) }}<span class="text-[16px] text-muted">%</span></template>
            <template v-else>—</template>
          </p>
        </div>
      </div>
      <p v-if="!nat && !st" class="mt-3.5 border-t border-line pt-3.5 text-[13px] leading-relaxed text-muted">
        Your predicted score appears after you have answered a few questions. Only answers count.
      </p>
      <div v-else-if="plan.plan.value && plan.plan.value.daysLeft != null" class="tabular mt-3.5 flex items-center gap-2 border-t border-line pt-3.5 text-[13px] font-bold text-muted">
        <Icon name="calendar" :size="15" />
        <span>{{ plan.plan.value.daysLeft }} days to your exam · {{ plan.plan.value.dailyTarget }} questions a day keeps you on pace</span>
      </div>
    </div>

    <nav class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" aria-label="Sections">
      <NuxtLink
        v-for="r in rows"
        :key="r.to"
        :to="r.to"
        class="flex min-h-[4rem] min-w-0 items-center gap-3.5 rounded-card border border-line bg-surface p-3.5 shadow-card transition-[transform,border-color] duration-150 ease-standard hover:border-line-strong active:scale-[0.99]"
      >
        <span class="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2"><Icon :name="r.icon" :size="21" /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-[15.5px] font-extrabold leading-tight">{{ r.label }}</span>
          <span class="block text-[12.5px] leading-snug text-muted">{{ r.hint }}</span>
        </span>
        <Badge v-if="r.count" tone="accent" size="md">{{ r.count }} due</Badge>
        <Icon name="chevron-right" :size="18" class="shrink-0 text-muted" />
      </NuxtLink>
    </nav>
  </div>
</template>
