<script setup lang="ts">
import type { NodeCoverage } from "~~/lib/study/coverage";
import type { Readiness } from "~~/lib/study/readiness";
import type { Pipeline } from "~~/lib/study/srs";
import { buildPlan } from "~~/lib/study/plan";
const settings = useSettings();
const study = useStudy();
const router = useRouter();
const freeTier = useFreeTier();
const entitlement = useEntitlement();
const gateHit = ref(false);
const banks = ref<{ national: string | null; state: string | null }>({ national: null, state: null });
const pipelines = ref<Record<string, Pipeline>>({});
const cover = ref<Record<string, NodeCoverage[] | null>>({});
const ready = ref<Record<string, Readiness | null>>({});
const active = ref<Awaited<ReturnType<typeof study.activeSession>>>(null);
const loading = ref(true);
const plan = computed(() => buildPlan({ examDate: settings.examDate, pipelines: Object.values(pipelines.value), coverage: Object.values(cover.value).flatMap((c) => c ?? []) }));

onMounted(async () => {
  if (!settings.jurisdiction) return router.replace("/");
  banks.value = await study.banks();
  active.value = await study.activeSession();
  for (const [portion, bank] of Object.entries(banks.value) as Array<["national" | "state", string | null]>) {
    if (!bank) continue;
    pipelines.value[bank] = await study.pipelineFor(bank);
    cover.value[bank] = await study.coverageFor(bank);
    ready.value[bank] = await study.readinessFor(bank, portion);
  }
  loading.value = false;
});
async function practice(kind: "practice" | "drill") {
  const bs = [banks.value.national, banks.value.state].filter((b): b is string => !!b);
  const s = await study.startSession(kind, { banks: bs });
  if (!s.itemIds.length) {
    await study.endSession(s);
    if (kind === "practice" && freeTier.exhausted.value) { gateHit.value = true; return; }
    alert(kind === "drill" ? "No leeches yet — nothing to drill." : "No questions available for this state yet.");
    return;
  }
  router.push("/study/practice");
}
async function ackSharing() { settings.set("sharingNoticeAck", true); await entitlement.ackSharingNotice(); }
</script>
<template>
  <div>
    <div class="row" style="justify-content:space-between">
      <h1>Study — {{ settings.jurisdiction }}</h1>
      <div class="row">
        <select :value="settings.licenseLevel" @change="settings.set('licenseLevel', ($event.target as HTMLSelectElement).value as any)">
          <option value="salesperson">Salesperson</option><option value="broker">Broker</option>
        </select>
        <button class="primary" @click="practice('practice')">Practice session</button>
        <button @click="practice('drill')">Leech drill</button>
        <NuxtLink class="btn" to="/study/mock">Full-length mock</NuxtLink>
      </div>
    </div>
    <div v-if="active" class="card"><strong>Resume</strong> your {{ active.kind }} session at question {{ active.position + 1 }} of {{ active.itemIds.length }}. <NuxtLink :to="active.kind === 'mock' ? '/study/mock/run' : '/study/practice'">Continue →</NuxtLink></div>
    <FreeTierGate :variant="gateHit ? 'block' : 'banner'" />
    <p v-if="!settings.sharingNoticeAck" class="notice">Your readiness score assumes one person is answering. Sharing this account will make it inaccurate. <button @click="ackSharing">Got it</button></p>
    <p v-if="loading" class="muted">Loading…</p>
    <PlanCard v-else :plan="plan" />
    <template v-for="(bank, portion) in banks" :key="portion">
      <div v-if="bank" class="card">
        <h2 style="text-transform:capitalize">{{ portion }} portion <span class="muted" style="font-size:14px">({{ bank.replace('national_', '').replace('state_', '') }})</span></h2>
        <ReadinessCard v-if="ready[bank]" :r="ready[bank]!" />
        <PipelineBar v-if="pipelines[bank]" :p="pipelines[bank]!" />
        <CoverageTable v-if="cover[bank]" :rows="cover[bank]!" />
      </div>
    </template>
  </div>
</template>
