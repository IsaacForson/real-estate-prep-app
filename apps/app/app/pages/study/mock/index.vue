<script setup lang="ts">
import { nationalBankFor } from "@rep/schema";
import { apportionIds } from "~~/lib/study/mockBuild";
const settings = useSettings();
const study = useStudy();
const router = useRouter();
const st = ref<Awaited<ReturnType<typeof study.state>>>(null);
onMounted(async () => { st.value = await study.state(); });
const exam = computed(() => st.value?.salesperson_exam);
async function start() {
  if (!st.value || !exam.value) return;
  const natBank = nationalBankFor(st.value.vendor);
  const portions: NonNullable<Parameters<typeof study.startSession>[1]["portions"]> = [];
  if (natBank && exam.value.national_items) {
    const bp = await study.blueprint(natBank);
    const ids = apportionIds(bp!, await study.source.ids(natBank), await study.getItems(await study.source.ids(natBank)), exam.value.national_items);
    portions.push({ portion: "national", bank: natBank, itemIds: ids, passScore: exam.value.pass_score_national ?? exam.value.pass_score_combined });
  }
  const stateBank = settings.stateBank!;
  const stateCount = exam.value.state_items ?? (natBank ? 0 : exam.value.total_items ?? 0);
  if (stateCount) {
    const bp = await study.blueprint(stateBank);
    const ids = bp ? apportionIds(bp, await study.source.ids(stateBank), await study.getItems(await study.source.ids(stateBank)), stateCount) : [];
    portions.push({ portion: "state", bank: stateBank, itemIds: ids, passScore: exam.value.pass_score_state ?? exam.value.pass_score_combined });
  }
  const all = portions.flatMap((p) => p.itemIds);
  if (!all.length) { alert("Not enough questions in this state's bank yet to build a full-length mock."); return; }
  await study.startSession("mock", { banks: portions.map((p) => p.bank), itemIds: all, timeLimitMs: exam.value.time_minutes ? exam.value.time_minutes * 60_000 : null, mockFormId: `local-${Date.now().toString(36)}`, portions });
  router.push("/study/mock/run");
}
</script>
<template>
  <div v-if="st && exam">
    <h1>Full-length mock — {{ st.name }}</h1>
    <div class="card">
      <p>Exactly your exam's format: <strong>{{ exam.national_items ?? 0 }}</strong> national + <strong>{{ exam.state_items ?? exam.total_items ?? 0 }}</strong> state questions, <strong>{{ exam.time_minutes ?? '—' }}</strong> minutes, {{ exam.grading === 'separate' ? 'each portion graded separately' : 'one combined score' }}.</p>
      <p class="muted">Pass: {{ exam.grading === 'separate' ? `${exam.pass_score_national ?? '—'} national · ${exam.pass_score_state ?? '—'} state` : (exam.pass_score_combined ?? '—') }}. Questions are drawn in the blueprint's proportions; a mock's answers update your spaced-repetition boxes only when you finish.</p>
      <p class="muted" v-if="exam.calculator_policy">Calculator: {{ exam.calculator_policy }}</p>
      <button class="primary" @click="start">Start timed mock</button>
    </div>
  </div>
</template>
