<script setup lang="ts">
import { JURISDICTIONS, isJurisdictionCode, nationalBankFor } from "@rep/schema";
const route = useRoute();
const code = String(route.params.code).toUpperCase();
if (!isJurisdictionCode(code)) throw createError({ statusCode: 404, statusMessage: "Unknown state" });
const { load } = useContent();
const { data: m } = await useAsyncData(`state-${code}`, () => load());
const st = computed(() => m.value?.states[code]);
const exam = computed(() => st.value?.salesperson_exam);
const settings = useSettings();
useHead({ title: `${JURISDICTIONS[code]} real estate exam: format, pass score, fees` });
</script>
<template>
  <div v-if="st">
    <h1>{{ JURISDICTIONS[code] }} real estate exam — what to expect</h1>
    <p class="muted">Sourced from the official candidate bulletin and the commission. Last verified {{ st.last_verified }}.</p>
    <div class="card">
      <h2>Exam format (salesperson / entry level)</h2>
      <table>
        <tbody>
          <tr><th>Vendor</th><td>{{ st.vendor }} <span class="muted" v-if="nationalBankFor(st.vendor)">→ we route you to the {{ nationalBankFor(st.vendor)?.replace('national_', '') }} national bank</span></td></tr>
          <tr><th>Questions</th><td>{{ exam?.national_items ?? '—' }} national + {{ exam?.state_items ?? '—' }} state = {{ exam?.total_items ?? '—' }} scored <span class="muted" v-if="exam?.pretest_items">(+ {{ exam.pretest_items }} unscored pretest)</span></td></tr>
          <tr><th>Time</th><td>{{ exam?.time_minutes ?? '—' }} minutes</td></tr>
          <tr><th>Passing</th><td>{{ exam?.grading === 'separate' ? `national ${exam?.pass_score_national ?? '—'}, state ${exam?.pass_score_state ?? '—'} (graded separately)` : (exam?.pass_score_combined ?? exam?.pass_score_national ?? '—') }}</td></tr>
          <tr><th>Fee</th><td>{{ exam?.exam_fee_usd != null ? `$${exam.exam_fee_usd}` : '—' }}</td></tr>
          <tr><th>Retakes</th><td>{{ exam?.retake_policy ?? '—' }}</td></tr>
          <tr><th>Calculator</th><td>{{ exam?.calculator_policy ?? '—' }}</td></tr>
          <tr><th>Pre-license hours</th><td>{{ st.prelicense_hours_salesperson ?? '—' }}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="card">
      <h2>Law you'll be tested on</h2>
      <p>{{ st.statute_citation_root }} <span class="muted" v-if="st.rules_citation_root">· {{ st.rules_citation_root }}</span></p>
      <p><a v-if="st.bulletin_url" :href="st.bulletin_url" target="_blank" rel="noopener">Official candidate bulletin</a> · <a v-if="st.regulator.url" :href="st.regulator.url" target="_blank" rel="noopener">{{ st.regulator.name }}</a></p>
      <p class="muted" v-if="st.unverified.length">Still being verified against primary sources: {{ st.unverified.join(', ') }}.</p>
      <p class="muted" v-if="st.notes">{{ st.notes }}</p>
    </div>
    <NuxtLink class="btn primary" to="/study" @click="settings.set('jurisdiction', code)">Study for {{ JURISDICTIONS[code] }}</NuxtLink>
  </div>
</template>
