/**
 * Background replay of the repo outbox + event queue (V2 §4). Debounced after every write, and run
 * on resume / coming back online / sign-in. The merge logic lives in lib/state/repo.ts and
 * lib/study/sync.ts; this composable only schedules, surfaces status and maps errors to actions
 * (session revoked → sign out; device not registered → register; rate limited → back off).
 */
import { isRateLimited, isSessionRequired, isSessionRevoked, isTransient } from "~~/lib/study/api";

const DEBOUNCE_MS = 3000;
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let started = false;

export function useSync() {
  const { repo, syncState: state } = useRepo();
  const events = useEvents();
  const auth = useAuth();
  const mode = useAppMode();

  /** Debounced: call after every persisted answer / session / settings change. */
  function schedule(delayMs = DEBOUNCE_MS): void {
    if (!import.meta.client || mode.value !== "api") return;
    state.value.pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void syncNow(); }, delayMs);
  }

  function syncNow(): Promise<void> {
    if (running) return running;
    running = run().finally(() => { running = null; });
    return running;
  }

  async function run(): Promise<void> {
    if (!import.meta.client || mode.value !== "api") return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    state.value.syncing = true;
    state.value.error = null;
    try {
      const r = await repo.flush({ pull: true });
      await events.flush();
      if (r.ok) {
        state.value.lastSyncAt = Date.now();
        state.value.pending = (await repo.pendingCount()) > 0;
        return;
      }
      if (r.reason !== "error") return;
      const e = r.error;
      if (isSessionRevoked(e)) { await auth.onSessionRevoked(e); return; }
      if (isSessionRequired(e)) { if (await auth.registerDevice()) schedule(1000); return; }
      state.value.error = e instanceof Error ? e.message : String(e);
      if (isRateLimited(e)) schedule(5 * 60_000);
      else if (isTransient(e)) schedule(60_000);
    } finally {
      state.value.syncing = false;
    }
  }

  /** Resume / online hooks; idempotent, called once from app.vue. */
  function start(): void {
    if (started || !import.meta.client) return;
    started = true;
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void syncNow(); });
    window.addEventListener("online", () => { void syncNow(); });
  }

  function dismissReverification() { state.value.reverificationRequested = false; }

  return { state, schedule, syncNow, start, dismissReverification };
}
