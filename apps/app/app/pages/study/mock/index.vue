<script setup lang="ts">
import { nationalBankFor } from "@rep/schema";
import { apportionIds } from "~~/lib/study/mockBuild";
const settings = useSettings();
const study = useStudy();
const router = useRouter();
const freeTier = useFreeTier();
const st = ref<Awaited<ReturnType<typeof study.state>>>(null);
const building = ref(false);
onMounted(async () => { st.value = await study.state(); await freeTier.load(); });
const exam = computed(() => st.value?.salesperson_exam);
const shortForm = computed(() => freeTier.applies.value);

async function start() {
  if (!st.value || !exam.value || building.value) return;
  if (freeTier.applies.value && freeTier.mockUsed.value) return;
  building.value = true;
  try {
    const natBank = nationalBankFor(st.value.vendor);
    const stateBank = settings.stateBank!;
    const natCount = natBank && exam.value.national_items ? exam.value.national_items : 0;
    const stateCount = exam.value.state_items ?? (natBank ? 0 : exam.value.total_items ?? 0);
    const fullTotal = natCount + stateCount;
    // free tier: one short form of 20 questions, split in the exam's proportions
    const target = shortForm.value ? Math.min(freeTier.mockSize, fullTotal) : fullTotal;
    const scale = fullTotal ? target / fullTotal : 0;
    const formId = shortForm.value ? freeTier.mockForm : `local-${Date.now().toString(36)}`;
    const portions: NonNullable<Parameters<typeof study.startSession>[1]["portions"]> = [];
    const plan: Array<{ portion: "national" | "state"; bank: string; count: number; pass: string | null }> = [];
    if (natBank && natCount) plan.push({ portion: "national", bank: natBank, count: Math.round(natCount * scale), pass: exam.value.pass_score_national ?? exam.value.pass_score_combined });
    if (stateCount) plan.push({ portion: "state", bank: stateBank, count: target - plan.reduce((a, p) => a + p.count, 0), pass: exam.value.pass_score_state ?? exam.value.pass_score_combined });
    for (const p of plan) {
      if (p.count <= 0) continue;
      // api mode: make sure the cache holds enough unseen items for this form (no-op for static)
      await study.source.prefetch?.(p.bank, p.count, { kind: "mock", formId });
      const bp = await study.blueprint(p.bank);
      const ids = freeTier.limit(await study.source.ids(p.bank));
      const picked = bp ? apportionIds(bp, ids, await study.getItems(ids), p.count) : [];
      portions.push({ portion: p.portion, bank: p.bank, itemIds: picked, passScore: p.pass });
    }
    const all = portions.flatMap((p) => p.itemIds);
    if (!all.length) { alert("Not enough questions in this state's bank yet to build a mock."); return; }
    const timeLimitMs = exam.value.time_minutes ? Math.round(exam.value.time_minutes * 60_000 * (fullTotal ? all.length / fullTotal : 1)) : null;
    if (shortForm.value) await freeTier.markMockUsed();
    await study.startSession("mock", { banks: portions.map((p) => p.bank), itemIds: all, timeLimitMs, mockFormId: formId, portions });
    router.push("/study/mock/run");
  } finally {
    building.value = false;
  }
}
</script>
<template>
  <div v-if="st && exam">
    <h1>{{ shortForm ? 'Short mock' : 'Full-length mock' }} — {{ st.name }}</h1>
    <FreeTierGate variant="banner" />
    <div v-if="freeTier.applies.value && freeTier.mockUsed.value" class="card" style="border-color:var(--accent)">
      <h2>Your free short mock is used</h2>
      <p>The free tier includes one {{ freeTier.mockSize }}-question mock. <strong>Complete</strong> includes five full-length, non-overlapping forms per state in your exam's exact format and timing — $59 once, forever.</p>
      <NuxtLink class="btn primary" to="/pricing">See Complete</NuxtLink>
    </div>
    <div v-else class="card">
      <p v-if="shortForm">A {{ freeTier.mockSize }}-question sample in your exam's proportions (national and state), timed proportionally. The full-length mock — <strong>{{ exam.national_items ?? 0 }}</strong> national + <strong>{{ exam.state_items ?? exam.total_items ?? 0 }}</strong> state questions in <strong>{{ exam.time_minutes ?? '—' }}</strong> minutes — is part of Complete.</p>
      <p v-else>Exactly your exam's format: <strong>{{ exam.national_items ?? 0 }}</strong> national + <strong>{{ exam.state_items ?? exam.total_items ?? 0 }}</strong> state questions, <strong>{{ exam.time_minutes ?? '—' }}</strong> minutes, {{ exam.grading === 'separate' ? 'each portion graded separately' : 'one combined score' }}.</p>
      <p class="muted">Pass: {{ exam.grading === 'separate' ? `${exam.pass_score_national ?? '—'} national · ${exam.pass_score_state ?? '—'} state` : (exam.pass_score_combined ?? '—') }}. Questions are drawn in the blueprint's proportions; a mock's answers update your spaced-repetition boxes only when you finish.</p>
      <p class="muted" v-if="exam.calculator_policy">Calculator: {{ exam.calculator_policy }}</p>
      <button class="primary" :disabled="building" @click="start">{{ building ? 'Preparing…' : shortForm ? 'Start short mock' : 'Start timed mock' }}</button>
    </div>
  </div>
</template>
