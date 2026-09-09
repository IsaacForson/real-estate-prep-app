<script setup lang="ts">
import type { Plan } from "~~/lib/study/plan";
/** Today's plan: daily target, days left, status; exam date editable in a sheet. */
const props = defineProps<{ plan: Plan | null; examDate: string | null }>();
const emit = defineEmits<{ (e: "set-exam-date", date: string | null): void }>();
const edit = ref(false);
const draft = ref(props.examDate ?? "");
watch(() => props.examDate, (d) => { draft.value = d ?? ""; });
const tone = computed(() => ({ "on-track": "ok", tight: "warn", behind: "danger", "no-date": "neutral", "exam-passed": "neutral" } as const)[props.plan?.status ?? "no-date"]);
const statusLabel = computed(() => ({ "on-track": "On track", tight: "Tight", behind: "Behind", "no-date": "No exam date", "exam-passed": "Exam date passed" })[props.plan?.status ?? "no-date"]);
function save() { emit("set-exam-date", draft.value || null); edit.value = false; }
</script>
<template>
  <AppCard title="Today's plan">
    <template #header>
      <button
        type="button"
        class="tap -mr-2 -mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 text-[13.5px] font-medium text-accent transition-colors hover:bg-accent-soft"
        @click="edit = true"
      >
        <Icon name="calendar" :size="15" />
        {{ examDate ? new Date(examDate + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Set exam date' }}
      </button>
    </template>

    <div v-if="plan && plan.dailyTarget != null && plan.daysLeft != null" class="mb-3.5 grid grid-cols-3 gap-2">
      <StatTile label="Answers today" :value="plan.dailyTarget" :tone="tone === 'neutral' ? 'default' : tone" />
      <StatTile label="Days left" :value="plan.daysLeft" />
      <StatTile label="Mocks to fit" :value="plan.mocksPlanned" />
    </div>

    <div class="flex items-start gap-2.5">
      <Badge :tone="tone">{{ statusLabel }}</Badge>
      <p class="text-[13.5px] leading-relaxed text-ink-2">
        {{ plan?.message ?? 'Set your exam date and the plan works backwards from it: unseen items, reds to clear, and the mocks to fit in.' }}
      </p>
    </div>

    <AppSheet :open="edit" title="Exam date" description="The plan schedules a 3-day review buffer before it." @close="edit = false">
      <form class="grid gap-4" @submit.prevent="save">
        <AppInput v-model="draft" type="date" label="Exam date" />
        <div class="flex gap-2">
          <AppButton v-if="examDate" variant="ghost" size="lg" @click="draft = ''; save()">Clear</AppButton>
          <AppButton type="submit" variant="primary" size="lg" block>Save</AppButton>
        </div>
      </form>
    </AppSheet>
  </AppCard>
</template>
