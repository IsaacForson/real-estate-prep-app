/**
 * Readiness (F5) per exam portion, computed from the server-hydrated progress rows in the repo.
 * Recomputes whenever the repo changes (answer, sync pull) or the jurisdiction / licence level
 * changes. Shapes are lib/study/readiness.ts `Readiness` — identical to what pages used before.
 */
import type { Readiness } from "~~/lib/study/readiness";

export interface ReadinessByPortion { national: Readiness | null; state: Readiness | null }

export function useReadiness() {
  const study = useStudy();
  const { version } = useRepo();
  const { settings } = useStudyState();
  const data = useState<ReadinessByPortion>("readiness", () => ({ national: null, state: null }));
  const loading = useState<boolean>("readiness.loading", () => false);
  const loaded = useState<boolean>("readiness.loaded", () => false);

  async function refresh(): Promise<ReadinessByPortion> {
    if (!import.meta.client) return data.value;
    loading.value = true;
    try {
      const b = await study.banks();
      const [national, state] = await Promise.all([
        b.national ? study.readinessFor(b.national, "national") : Promise.resolve(null),
        b.state ? study.readinessFor(b.state, "state") : Promise.resolve(null),
      ]);
      data.value = { national, state };
      loaded.value = true;
      return data.value;
    } finally {
      loading.value = false;
    }
  }

  /** The portion most learners look at first: state when it exists, else national. */
  const primary = computed(() => data.value.state ?? data.value.national);
  /** 0..100 across both portions, weighted by scored items */
  const overallPct = computed(() => {
    const parts = [data.value.national, data.value.state].filter((r): r is Readiness => !!r);
    const items = parts.reduce((a, r) => a + r.scoredItems, 0);
    return items ? Math.round(parts.reduce((a, r) => a + r.expectedScore, 0) / items * 100) : null;
  });

  // one watcher per consuming component (disposed with it); callers outside a scope use refresh()
  if (import.meta.client && getCurrentScope()) {
    watch([version, () => settings.value.jurisdiction, () => settings.value.licenseLevel], () => { void refresh(); }, { immediate: !loaded.value });
  }

  return { national: computed(() => data.value.national), state: computed(() => data.value.state), primary, overallPct, loading, loaded, refresh };
}
