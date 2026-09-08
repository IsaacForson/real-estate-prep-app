/**
 * Background sync with apps/api `sync-progress` (F7/F8). Debounced after every answer, and run on
 * app resume / coming back online. Pure merge logic lives in lib/study/sync.ts; this reads and
 * writes Dexie and handles the wire. Only active in api mode — static and signed-out free study
 * never make a network call on the study path.
 */
import { getDb } from "~~/lib/study/db";
import { callFunction, functionsBase, isRateLimited, isSessionRequired, isSessionRevoked, isTransient } from "~~/lib/study/api";
import { buildSyncPayload, mergeServerProgress, mergeServerSessions, type SyncResponse } from "~~/lib/study/sync";
import type { Progress, StudySession } from "~~/lib/study/types";

export interface SyncState {
  syncing: boolean;
  pending: boolean;
  lastSyncAt: number | null;
  error: string | null;
  /** SPEC §5.3 soft response: a re-verification email was queued; nothing is blocked. */
  reverificationRequested: boolean;
}

const DEBOUNCE_MS = 3000;
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let started = false;

export function useSync() {
  const state = useState<SyncState>("sync", () => ({ syncing: false, pending: false, lastSyncAt: null, error: null, reverificationRequested: false }));
  const auth = useAuth();
  const mode = useAppMode();
  const config = useRuntimeConfig();

  /** Debounced: call after every persisted answer / session change. */
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
    const headers = await auth.apiHeaders();
    if (!headers) return;
    const db = getDb();
    state.value.syncing = true;
    state.value.error = null;
    try {
      const pushedAfter = ((await db.kv.get("sync.pushedAfter"))?.value as number | undefined) ?? 0;
      const since = ((await db.kv.get("sync.since"))?.value as string | undefined) ?? null;
      const startedAt = Date.now();
      const progress = await db.progress.where("clientUpdatedAt").above(pushedAfter).toArray();
      const sessions = await db.sessions.where("clientUpdatedAt").above(pushedAfter).toArray();
      const payload = buildSyncPayload({ progress, sessions, pushedAfter, since });
      const body: Record<string, unknown> = { progress: payload.progress, study_sessions: payload.study_sessions };
      if (since) body.since = since;
      const res = await callFunction<SyncResponse>(functionsBase(config.public.supabaseUrl), "sync-progress", body, headers);

      // pull: rows the server holds that are newer than ours (lww)
      const sp = res.server?.progress ?? [];
      if (sp.length) {
        const ids = sp.map((r) => r.public_id);
        const local = new Map<string, Progress>();
        for (const row of await db.progress.bulkGet(ids)) if (row) local.set(row.itemId, row);
        const meta = new Map<string, { bank: string; node: string }>();
        for (const c of await db.items.bulkGet(ids)) if (c) meta.set(c.id, { bank: c.bank, node: c.node });
        const writes = mergeServerProgress(local, sp, (id) => meta.get(id));
        if (writes.length) await db.progress.bulkPut(writes);
      }
      const ss = res.server?.study_sessions ?? [];
      if (ss.length) {
        const local = new Map<string, StudySession>();
        for (const row of await db.sessions.bulkGet(ss.map((r) => r.id))) if (row) local.set(row.id, row);
        const writes = mergeServerSessions(local, ss);
        if (writes.length) await db.sessions.bulkPut(writes);
      }

      await db.kv.bulkPut([{ key: "sync.pushedAfter", value: startedAt }, { key: "sync.since", value: res.server_time }]);
      state.value.lastSyncAt = Date.now();
      state.value.pending = false;
      if (res.reverification_requested) state.value.reverificationRequested = true;
      if (payload.hasMore) schedule(500);
    } catch (e) {
      if (isSessionRevoked(e)) { await auth.onSessionRevoked(); return; }
      if (isSessionRequired(e)) { await auth.registerDevice(); return; }
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
