/**
 * Blueprint coverage (F4) and SRS pipeline (F10) per bank, from the repo's progress rows. Same
 * shapes as lib/study/coverage.ts `NodeCoverage` / lib/study/srs.ts `Pipeline`.
 */
import type { NodeCoverage } from "~~/lib/study/coverage";
import { totals } from "~~/lib/study/coverage";
import type { Pipeline } from "~~/lib/study/srs";

export function useCoverage() {
  const study = useStudy();
  const { version } = useRepo();
  const { settings } = useStudyState();
  const rows = useState<Record<string, NodeCoverage[] | null>>("coverage.rows", () => ({}));
  const pipelines = useState<Record<string, Pipeline>>("coverage.pipelines", () => ({}));
  const loading = useState<boolean>("coverage.loading", () => false);
  const loaded = useState<boolean>("coverage.loaded", () => false);

  async function refresh(): Promise<void> {
    if (!import.meta.client) return;
    loading.value = true;
    try {
      const b = await study.banks();
      const banks = [b.national, b.state].filter((x): x is string => !!x);
      const nextRows: Record<string, NodeCoverage[] | null> = {};
      const nextPipes: Record<string, Pipeline> = {};
      await Promise.all(banks.map(async (bank) => {
        const [c, p] = await Promise.all([study.coverageFor(bank), study.pipelineFor(bank)]);
        nextRows[bank] = c;
        nextPipes[bank] = p;
      }));
      rows.value = nextRows;
      pipelines.value = nextPipes;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  const banks = computed(() => Object.keys(rows.value));
  const national = computed(() => { const k = banks.value.find((b) => b.startsWith("national_")); return k ? rows.value[k] ?? null : null; });
  const state = computed(() => { const k = banks.value.find((b) => b.startsWith("state_")); return k ? rows.value[k] ?? null : null; });
  const all = computed(() => Object.values(rows.value).flatMap((c) => c ?? []));
  const summary = computed(() => totals(all.value));
  const pipeline = computed<Pipeline>(() => {
    const out: Pipeline = { red: 0, yellow: 0, green: 0, unseen: 0, leeches: 0, dueNow: 0 };
    for (const p of Object.values(pipelines.value)) { out.red += p.red; out.yellow += p.yellow; out.green += p.green; out.unseen += p.unseen; out.leeches += p.leeches; out.dueNow += p.dueNow; }
    return out;
  });

  // one watcher per consuming component (disposed with it); callers outside a scope use refresh()
  if (import.meta.client && getCurrentScope()) {
    watch([version, () => settings.value.jurisdiction, () => settings.value.licenseLevel], () => { void refresh(); }, { immediate: !loaded.value });
  }

  return { rows, pipelines, national, state, all, summary, pipeline, loading, loaded, refresh };
}
