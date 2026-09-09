/**
 * Server-backed learner settings + study plan (V2 §6.1). Replaces the Pinia settings store for
 * everything learner-scoped; theme stays local (stores/settings.ts). Writes go through the repo
 * (cache now, `study_state` row on the next flush) and emit `settings_changed`.
 */
import type { Plan, StudySettings } from "~~/lib/state/types";

export function useStudyState() {
  const { repo, settings, plan } = useRepo();
  const auth = useAuth();
  const events = useEvents();
  const sync = useSync();
  /** true once the signed-in user's study_state was hydrated (or immediately in static dev mode) */
  const ready = useState<boolean>("studyState.ready", () => false);

  async function set(patch: Partial<StudySettings>): Promise<void> {
    const before = repo.settings();
    const next = await repo.setSettings(patch);
    const changed = (Object.keys(patch) as Array<keyof StudySettings>).filter((k) => before[k] !== next[k]);
    if (changed.length) {
      events.track("settings_changed", { keys: changed, jurisdiction: next.jurisdiction || null });
      sync.schedule(1500);
    }
  }

  async function setPlan(next: Plan | null): Promise<void> {
    await repo.setPlan(next);
    sync.schedule(5000);
  }

  const stateBank = computed(() => (settings.value.jurisdiction ? `state_${settings.value.jurisdiction}` : null));
  const signedIn = computed(() => !!auth.user.value);

  return { settings, set, plan, setPlan, ready, stateBank, signedIn };
}
