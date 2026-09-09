<script setup lang="ts">
import { JURISDICTIONS, isJurisdictionCode, nationalBankFor } from "@rep/schema";
/** Per-state exam brief (SEO page). Sourced from the official bulletin; shows last_verified. */
const route = useRoute();
const code = String(route.params.code).toUpperCase();
if (!isJurisdictionCode(code)) throw createError({ statusCode: 404, statusMessage: "Unknown state" });
const content = useContent();
const { data: m } = await useAsyncData(`state-${code}`, () => content.load());
const auth = useAuth();
const st = computed(() => m.value?.states[code]);
const exam = computed(() => st.value?.salesperson_exam);
const status = computed(() => m.value?.status[code]);
const bank = computed(() => (st.value ? nationalBankFor(st.value.vendor) : null));
useHead({
  title: `${JURISDICTIONS[code]} real estate exam: format, pass score, fees`,
  meta: [{ name: "description", content: `${JURISDICTIONS[code]} real estate licensing exam — vendor, question counts, time limit, passing score, fees and the statutes tested. Sourced from the official candidate bulletin.` }],
});
const passing = computed(() => {
  const e = exam.value; if (!e) return "—";
  return e.grading === "separate" ? `National ${e.pass_score_national ?? "—"} · State ${e.pass_score_state ?? "—"} (graded separately)` : (e.pass_score_combined ?? e.pass_score_national ?? "—");
});
const rows = computed(() => [
  ["Vendor", st.value?.vendor ?? "—"],
  ["Questions", `${exam.value?.national_items ?? "—"} national + ${exam.value?.state_items ?? "—"} state = ${exam.value?.total_items ?? "—"} scored${exam.value?.pretest_items ? ` (+ ${exam.value.pretest_items} unscored pretest)` : ""}`],
  ["Time", exam.value?.time_minutes ? `${exam.value.time_minutes} minutes` : "—"],
  ["Passing", passing.value],
  ["Fee", exam.value?.exam_fee_usd != null ? `$${exam.value.exam_fee_usd}` : "—"],
  ["Retakes", exam.value?.retake_policy ?? "—"],
  ["Calculator", exam.value?.calculator_policy ?? "—"],
  ["Pre-license hours", st.value?.prelicense_hours_salesperson ?? "—"],
]);
</script>
<template>
  <div v-if="st" class="max-w-4xl mx-auto safe-px py-8 md:py-14 grid gap-6 anim-fade-up">
    <NuxtLink to="/states" class="inline-flex items-center gap-1 text-sm text-accent font-medium"><Icon name="arrow-left" :size="16" />All states</NuxtLink>
    <header class="grid gap-3">
      <div class="flex flex-wrap items-center gap-2"><Badge tone="accent" size="md">{{ code }}</Badge><Badge :tone="st.confidence === 'high' ? 'ok' : st.confidence === 'medium' ? 'warn' : 'outline'" size="md">verified {{ st.last_verified }}</Badge></div>
      <h1 class="text-3xl md:text-5xl display">{{ JURISDICTIONS[code] }} real estate exam — what to expect</h1>
      <p class="text-ink-2">Sourced from the official candidate bulletin and {{ st.regulator.name }}. Confirm current requirements with the state before you schedule; formats and fees change.</p>
    </header>

    <div class="grid md:grid-cols-[1.2fr_1fr] gap-4 items-start">
      <AppCard title="Exam format" subtitle="Salesperson / entry level" padding="none">
        <dl class="divide-y divide-line">
          <div v-for="[k, v] in rows" :key="k" class="grid grid-cols-[130px_1fr] gap-3 px-4 sm:px-5 py-3 text-sm"><dt class="text-muted">{{ k }}</dt><dd class="text-ink">{{ v }}</dd></div>
        </dl>
        <p v-if="bank" class="px-4 sm:px-5 py-3 text-xs text-muted border-t border-line">{{ st.vendor === 'psi' ? 'PSI' : 'Pearson VUE' }} administers the exam, so we route you to the <strong class="text-ink">{{ bank.replace('national_', '') }}</strong> national bank, weighted to its published outline.</p>
      </AppCard>
      <div class="grid gap-4">
        <AppCard title="Law you'll be tested on">
          <p class="font-serif text-lg">{{ st.statute_citation_root ?? '—' }}</p>
          <p v-if="st.rules_citation_root" class="text-sm text-muted mt-1">{{ st.rules_citation_root }}</p>
          <div class="mt-3 grid gap-1.5 text-sm">
            <a v-if="st.bulletin_url" :href="st.bulletin_url" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-accent font-medium"><Icon name="external" :size="15" />Official candidate bulletin</a>
            <a v-if="st.statute_url" :href="st.statute_url" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-accent font-medium"><Icon name="external" :size="15" />Statute text</a>
            <a v-if="st.regulator.url" :href="st.regulator.url" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-accent font-medium"><Icon name="external" :size="15" />{{ st.regulator.name }}</a>
          </div>
          <p v-if="st.unverified.length" class="mt-3 text-xs text-warn">Still being verified against primary sources: {{ st.unverified.join(', ') }}.</p>
          <p v-if="st.notes" class="mt-2 text-xs text-muted">{{ st.notes }}</p>
        </AppCard>
        <AppCard tone="accent">
          <p class="eyebrow text-accent">Our {{ code }} bank</p>
          <p class="mt-1 text-2xl display tabular">{{ status?.phase === 'complete' ? status.published : ((status?.verified ?? 0) + (status?.published ?? 0)) || '—' }} <span class="text-sm font-normal text-ink-2">{{ status?.phase === 'complete' ? 'published questions' : 'verified questions · in production' }}</span></p>
          <p class="mt-2 text-sm text-ink-2">Each cites the {{ st.statute_citation_root ?? 'statute' }} section it rests on. {{ status?.mocks ? `${status.mocks} full-length mock forms.` : 'Mock forms arrive as the bank fills.' }}</p>
          <AppButton :to="auth.signedIn.value ? '/app' : '/signin'" variant="primary" class="mt-4" icon-right="arrow-right">Study for {{ JURISDICTIONS[code] }}</AppButton>
        </AppCard>
      </div>
    </div>
  </div>
</template>
