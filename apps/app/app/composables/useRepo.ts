/**
 * The one StudyRepo instance (lib/state/repo.ts) wired to Dexie + Supabase, plus the reactive
 * mirrors composables read: `version` (bumped on every change), study settings/plan, sync state.
 * Internal to WP-B; screens use useStudyState / useStudy / useReadiness … instead.
 */
import { DexieCache, MemoryCache } from "~~/lib/state/cache";
import { StudyRepo } from "~~/lib/state/repo";
import { SupabaseRemote, type RemoteStore } from "~~/lib/state/remote";
import { defaultSettings, type Plan, type StudySettings } from "~~/lib/state/types";
import { functionsBase } from "~~/lib/study/api";
import { getDb } from "~~/lib/study/db";

export interface SyncState {
  syncing: boolean;
  pending: boolean;
  lastSyncAt: number | null;
  error: string | null;
  /** SPEC §5.3 soft response: a re-verification email was queued; nothing is blocked. */
  reverificationRequested: boolean;
}
export const defaultSyncState = (): SyncState => ({ syncing: false, pending: false, lastSyncAt: null, error: null, reverificationRequested: false });

let repo: StudyRepo | null = null;
let remote: RemoteStore | null = null;

export function useRepo() {
  const auth = useAuth();
  const supabase = useSupabase();
  const config = useRuntimeConfig();
  const version = useState<number>("repo.version", () => 0);
  const settings = useState<StudySettings>("studyState.settings", defaultSettings);
  const plan = useState<Plan | null>("studyState.plan", () => null);
  const syncState = useState<SyncState>("sync", defaultSyncState);
  const settingsStore = useSettings();

  if (!repo) {
    if (import.meta.client && supabase) {
      remote = new SupabaseRemote({
        supabase,
        base: functionsBase(config.public.supabaseUrl),
        uid: () => auth.user.value?.id ?? null,
        authHeaders: () => auth.authHeaders(),
        apiHeaders: () => auth.apiHeaders(),
        anonHeaders: () => ({ apikey: config.public.supabaseAnonKey }),
      });
    }
    repo = new StudyRepo({
      cache: import.meta.client ? new DexieCache(getDb()) : new MemoryCache(),
      remote: () => (auth.user.value ? remote : null),
      online: () => typeof navigator === "undefined" || navigator.onLine !== false,
      onSyncResult: (res) => { if (res.reverification_requested) syncState.value.reverificationRequested = true; },
      onError: (e, where) => { if (import.meta.dev) console.warn(`[repo] ${where}`, e); },
    });
    const mirror = () => {
      version.value++;
      settings.value = repo!.settings();
      plan.value = repo!.plan();
      // legacy Pinia store keeps reflecting the server-backed values for pages not yet rewritten
      settingsStore.$patch({ ...repo!.settings() });
    };
    repo.subscribe(mirror);
    if (import.meta.client) void repo.open();
  }

  return { repo, remote, version, settings, plan, syncState };
}
