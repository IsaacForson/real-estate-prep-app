/**
 * Study plan (F20) back-planned from the exam date, computed from coverage + pipelines and stored
 * in `study_state.plan` so the admin console and other devices see the same numbers.
 */
import { buildPlan, type Plan } from "~~/lib/study/plan";

export function usePlan() {
  const cov = useCoverage();
  const studyState = useStudyState();
  const plan = computed<Plan | null>(() => {
    if (!cov.loaded.value) return studyState.plan.value;
    return buildPlan({ examDate: studyState.settings.value.examDate, pipelines: Object.values(cov.pipelines.value), coverage: cov.all.value });
  });

  if (import.meta.client && getCurrentScope()) {
    // persist a materially different plan (daily target / status) — not every recompute
    watch(plan, (p, prev) => {
      if (!p || !cov.loaded.value) return;
      const stored = studyState.plan.value;
      if (stored && stored.dailyTarget === p.dailyTarget && stored.status === p.status && stored.daysLeft === p.daysLeft && stored.answersNeeded === p.answersNeeded) return;
      if (prev && prev.dailyTarget === p.dailyTarget && prev.status === p.status && prev.daysLeft === p.daysLeft && prev.answersNeeded === p.answersNeeded && stored) return;
      void studyState.setPlan(p);
    });
  }

  async function setExamDate(date: string | null) { await studyState.set({ examDate: date }); }

  return { plan, examDate: computed(() => studyState.settings.value.examDate), setExamDate, refresh: cov.refresh };
}
