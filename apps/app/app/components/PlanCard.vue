<script setup lang="ts">
import type { Plan } from "~~/lib/study/plan";
const props = defineProps<{ plan: Plan }>();
const settings = useSettings();
const color = computed(() => ({ "on-track": "green", tight: "yellow", behind: "red", "no-date": "", "exam-passed": "" }[props.plan.status]));
</script>
<template>
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <h2>Study plan</h2>
      <label class="muted" style="font-size:14px">Exam date <input type="date" :value="settings.examDate ?? ''" @change="settings.set('examDate', ($event.target as HTMLInputElement).value || null)" /></label>
    </div>
    <div class="row" v-if="plan.daysLeft != null && plan.dailyTarget != null">
      <span class="pill" :class="color"><strong>{{ plan.dailyTarget }}</strong> answers / day</span>
      <span class="muted">{{ plan.daysLeft }} days left · {{ plan.unseen }} unseen · {{ plan.redOrLeech }} red · {{ plan.mocksPlanned }} mocks to schedule</span>
    </div>
    <p class="muted" style="margin:6px 0 0">{{ plan.message }}</p>
  </div>
</template>
