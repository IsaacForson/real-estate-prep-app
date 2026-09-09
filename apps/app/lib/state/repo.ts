/**
 * Server-authoritative repository for learner state (V2 §1, §4).
 *
 *   reads   → the cache (hydrated from the server on sign-in, refreshed by every flush)
 *   writes  → the cache immediately (so the UI never waits on the network) AND the outbox; the
 *             outbox is replayed by `flush()` — on a debounce after every answer, on resume, on
 *             `online`, and right after hydrate. Nothing is authoritative until the server took it.
 *   merge   → last-write-wins by the client clock (`clientUpdatedAt` / `updated_at`), the same rule
 *             the database triggers apply; pure merge functions live in lib/study/sync.ts.
 *
 * Learner-scoped data belongs to exactly one uid (`repo.owner` in kv). Hydrating a different uid
 * clears the cache first, so a device shared between accounts never leaks progress.
 * Framework-free: cache/remote are injected; the Nuxt composables wrap one shared instance.
 */
import type { Plan } from "../study/plan.js";
import {
  MAX_PROGRESS_ROWS, MAX_SESSION_ROWS, dedupeNewest, mergeServerProgress, mergeServerSessions, toServerProgress, toServerSession,
  type ServerProgressRow, type ServerSessionRow, type SyncResponse,
} from "../study/sync.js";
import type { Progress, StudySession } from "../study/types.js";
import { OWNER_KV_KEY, type CacheStore } from "./cache.js";
import type { RemoteStore } from "./remote.js";
import { defaultSettings, normalizeSettings, type CachedStudyState, type OutboxEntry, type StudySettings, type StudyStateRow } from "./types.js";

export const STUDY_STATE_KV = "studyState";
export const ACTIVE_SESSION_KV = "activeSession";
export const SYNC_SINCE_KV = "sync.since";
const STUDY_STATE_KEY = "study_state";
const MAX_FLUSH_ROUNDS = 6;

export interface RepoDeps {
  cache: CacheStore;
  /** null → no server (static dev mode, or signed out): the cache is all there is. */
  remote: () => RemoteStore | null;
  now?: () => number;
  online?: () => boolean;
  onSyncResult?: (res: SyncResponse) => void;
  onError?: (e: unknown, where: string) => void;
}

export interface FlushResult {
  ok: boolean;
  /** why nothing was sent */
  reason?: "no_remote" | "offline" | "error";
  pushedProgress: number;
  pushedSessions: number;
  pushedStudyState: boolean;
  pulledProgress: number;
  pulledSessions: number;
  error?: unknown;
}

const iso = (ms: number) => new Date(ms).toISOString();

export class StudyRepo {
  private listeners = new Set<() => void>();
  private flushing: Promise<FlushResult> | null = null;
  private state: CachedStudyState | null = null;
  private opened = false;
  /** uid whose rows the cache holds (null before hydrate / in static mode) */
  owner: string | null = null;

  constructor(private deps: RepoDeps) {}

  private now() { return (this.deps.now ?? Date.now)(); }
  private online() { return this.deps.online ? this.deps.online() : true; }
  private fail(e: unknown, where: string) { this.deps.onError?.(e, where); }

  // ---- change notification --------------------------------------------------------------------

  /** Called after every local write or server merge; composables bump a version ref. */
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify() { for (const fn of this.listeners) { try { fn(); } catch { /* listener bug must not break writes */ } } }

  // ---- lifecycle --------------------------------------------------------------------------------

  /** Load what the cache already holds (owner + study state) without touching the network. */
  async open(): Promise<void> {
    if (this.opened) return;
    this.opened = true;
    this.owner = (await this.deps.cache.getKv<string>(OWNER_KV_KEY)) ?? null;
    this.state = (await this.deps.cache.getKv<CachedStudyState>(STUDY_STATE_KV)) ?? null;
    if (this.state) this.state.settings = normalizeSettings(this.state.settings);
    this.notify();
  }

  /**
   * Sign-in / launch: make the cache mirror `uid`. A different previous owner wipes learner data
   * first. Then pull study_state, push the outbox and pull progress/sessions (full pull when the
   * watermark was cleared). Network failures leave the cache as-is; nothing throws.
   */
  async hydrate(uid: string): Promise<void> {
    await this.open();
    if (this.owner && this.owner !== uid) {
      await this.deps.cache.clearLearnerData();
      this.state = null;
    }
    if (this.owner !== uid) {
      this.owner = uid;
      await this.deps.cache.putKv(OWNER_KV_KEY, uid);
    }
    this.notify();
    const remote = this.deps.remote();
    if (!remote || !this.online()) return;
    try {
      await this.adoptServerStudyState(await remote.getStudyState());
    } catch (e) { this.fail(e, "study_state.get"); }
    await this.flush({ pull: true });
  }

  // ---- study state (settings + plan) -----------------------------------------------------------

  settings(): StudySettings { return this.state?.settings ?? defaultSettings(); }
  plan(): Plan | null { return this.state?.plan ?? null; }
  /** ms clock of the current study_state (0 when none) */
  stateUpdatedAt(): number { return this.state?.updatedAt ?? 0; }

  async setSettings(patch: Partial<StudySettings>): Promise<StudySettings> {
    const next = normalizeSettings({ ...this.settings(), ...patch });
    await this.writeStudyState({ settings: next, plan: this.plan() });
    return next;
  }

  async setPlan(plan: Plan | null): Promise<void> {
    await this.writeStudyState({ settings: this.settings(), plan });
  }

  private async writeStudyState(next: { settings: StudySettings; plan: Plan | null }): Promise<void> {
    const updatedAt = Math.max(this.now(), (this.state?.updatedAt ?? 0) + 1);
    this.state = { settings: next.settings, plan: next.plan, updatedAt };
    await this.deps.cache.putKv(STUDY_STATE_KV, this.state);
    if (this.owner) {
      const row: StudyStateRow = { user_id: this.owner, settings: next.settings, plan: next.plan, updated_at: iso(updatedAt) };
      await this.deps.cache.outboxPut([{ key: STUDY_STATE_KEY, kind: "study_state", payload: row, at: updatedAt, attempts: 0 }]);
    }
    this.notify();
  }

  /** LWW between the server row and what we hold; queues a push when ours is newer. */
  private async adoptServerStudyState(row: StudyStateRow | null): Promise<void> {
    if (!row) {
      if (this.state && this.owner) {
        const pending = (await this.deps.cache.outboxAll()).some((e) => e.key === STUDY_STATE_KEY);
        if (!pending) await this.writeStudyState({ settings: this.state.settings, plan: this.state.plan });
      }
      return;
    }
    const serverAt = Date.parse(row.updated_at);
    if (!Number.isFinite(serverAt)) return;
    if (!this.state || serverAt > this.state.updatedAt) {
      this.state = { settings: normalizeSettings(row.settings), plan: row.plan ?? null, updatedAt: serverAt };
      await this.deps.cache.putKv(STUDY_STATE_KV, this.state);
      const pending = (await this.deps.cache.outboxAll()).find((e) => e.key === STUDY_STATE_KEY);
      if (pending && pending.at <= serverAt) await this.deps.cache.outboxDelete([STUDY_STATE_KEY]);
      this.notify();
    }
  }

  // ---- progress ---------------------------------------------------------------------------------

  getProgress(itemId: string) { return this.deps.cache.getProgress(itemId); }
  async progressMap(bank?: string): Promise<Map<string, Progress>> {
    const rows = bank ? await this.deps.cache.progressByBank(bank) : await this.deps.cache.allProgress();
    return new Map(rows.map((r) => [r.itemId, r]));
  }
  allProgress() { return this.deps.cache.allProgress(); }

  async putProgress(rows: Progress[]): Promise<void> {
    if (!rows.length) return;
    await this.deps.cache.putProgress(rows);
    await this.deps.cache.outboxPut(rows.map((p) => ({ key: `progress:${p.itemId}`, kind: "progress" as const, payload: toServerProgress(p), at: p.clientUpdatedAt, attempts: 0 })));
    this.notify();
  }

  // ---- sessions ---------------------------------------------------------------------------------

  getSession(id: string) { return this.deps.cache.getSession(id); }
  allSessions() { return this.deps.cache.allSessions(); }

  async putSession(s: StudySession): Promise<void> {
    await this.deps.cache.putSessions([s]);
    const row = toServerSession(s);
    if (row) await this.deps.cache.outboxPut([{ key: `session:${s.id}`, kind: "session", payload: row, at: s.clientUpdatedAt, attempts: 0 }]);
    this.notify();
  }

  async setActiveSession(id: string | null): Promise<void> {
    if (id) await this.deps.cache.putKv(ACTIVE_SESSION_KV, id);
    else await this.deps.cache.deleteKv(ACTIVE_SESSION_KV);
    this.notify();
  }

  /** The unfinished session to resume, if any (kv pointer first, else the newest open session). */
  async activeSession(): Promise<StudySession | null> {
    const id = await this.deps.cache.getKv<string>(ACTIVE_SESSION_KV);
    if (id) {
      const s = await this.deps.cache.getSession(id);
      if (s && !s.endedAt) return s;
    }
    const open = (await this.deps.cache.allSessions()).filter((s) => !s.endedAt && s.itemIds.length > 0).sort((a, b) => b.clientUpdatedAt - a.clientUpdatedAt);
    return open[0] ?? null;
  }

  // ---- outbox replay + pull ----------------------------------------------------------------------

  async pendingCount(): Promise<number> {
    return (await this.deps.cache.outboxAll()).filter((e) => e.kind !== "event").length;
  }

  /** Replay the outbox and pull newer server rows. Coalesces concurrent callers. */
  flush(opts: { pull?: boolean } = {}): Promise<FlushResult> {
    if (this.flushing) return this.flushing;
    this.flushing = this.run(opts.pull ?? false).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async run(pull: boolean): Promise<FlushResult> {
    const out: FlushResult = { ok: true, pushedProgress: 0, pushedSessions: 0, pushedStudyState: false, pulledProgress: 0, pulledSessions: 0 };
    const remote = this.deps.remote();
    if (!remote || !this.owner) return { ...out, ok: false, reason: "no_remote" };
    if (!this.online()) return { ...out, ok: false, reason: "offline" };
    try {
      let doPull = pull;
      for (let round = 0; round < MAX_FLUSH_ROUNDS; round++) {
        const entries = await this.deps.cache.outboxAll();
        const prog = entries.filter((e) => e.kind === "progress").sort((a, b) => a.at - b.at);
        const sess = entries.filter((e) => e.kind === "session").sort((a, b) => a.at - b.at);
        if (!prog.length && !sess.length && !doPull) break;
        const progBatch = prog.slice(0, MAX_PROGRESS_ROWS);
        const sessBatch = sess.slice(0, MAX_SESSION_ROWS);
        const since = (await this.deps.cache.getKv<string>(SYNC_SINCE_KV)) ?? null;
        const res = await remote.sync({
          progress: dedupeNewest(progBatch.map((e) => e.payload as ServerProgressRow), (r) => r.public_id),
          study_sessions: dedupeNewest(sessBatch.map((e) => e.payload as ServerSessionRow), (r) => r.id),
          since,
        });
        await this.deleteIfCurrent([...progBatch, ...sessBatch]);
        out.pushedProgress += progBatch.length;
        out.pushedSessions += sessBatch.length;
        const merged = await this.mergeServer(res);
        out.pulledProgress += merged.progress;
        out.pulledSessions += merged.sessions;
        if (res.server_time) await this.deps.cache.putKv(SYNC_SINCE_KV, res.server_time);
        this.deps.onSyncResult?.(res);
        doPull = false;
        if (prog.length <= progBatch.length && sess.length <= sessBatch.length) break;
      }
      const st = (await this.deps.cache.outboxAll()).find((e) => e.kind === "study_state");
      if (st) {
        const row = st.payload as StudyStateRow;
        const returned = await remote.putStudyState({ ...row, user_id: this.owner });
        await this.deleteIfCurrent([st]);
        out.pushedStudyState = true;
        if (returned) await this.adoptServerStudyState(returned);
        else await this.adoptServerStudyState(await remote.getStudyState().catch(() => null));
      }
      this.notify();
      return out;
    } catch (e) {
      this.fail(e, "flush");
      return { ...out, ok: false, reason: "error", error: e };
    }
  }

  /** Remove pushed entries unless a newer write replaced them while the request was in flight. */
  private async deleteIfCurrent(sent: OutboxEntry[]): Promise<void> {
    if (!sent.length) return;
    const now = new Map((await this.deps.cache.outboxAll()).map((e) => [e.key, e]));
    const keys = sent.filter((e) => now.get(e.key)?.at === e.at).map((e) => e.key);
    await this.deps.cache.outboxDelete(keys);
  }

  /** Server rows strictly newer than ours are written to the cache (never to the outbox). */
  private async mergeServer(res: SyncResponse): Promise<{ progress: number; sessions: number }> {
    let progress = 0, sessions = 0;
    const sp = res.server?.progress ?? [];
    if (sp.length) {
      const ids = sp.map((r) => r.public_id);
      const local = new Map<string, Progress>();
      for (const row of await this.deps.cache.getProgressMany(ids)) if (row) local.set(row.itemId, row);
      const meta = await this.deps.cache.itemMeta(ids);
      const writes = mergeServerProgress(local, sp, (id) => meta.get(id));
      if (writes.length) { await this.deps.cache.putProgress(writes); progress = writes.length; }
    }
    const ss = res.server?.study_sessions ?? [];
    if (ss.length) {
      const local = new Map<string, StudySession>();
      for (const row of await this.deps.cache.getSessionsMany(ss.map((r) => r.id))) if (row) local.set(row.id, row);
      const writes = mergeServerSessions(local, ss);
      if (writes.length) { await this.deps.cache.putSessions(writes); sessions = writes.length; }
      // a session left open on another device becomes resumable here (V2 §1)
      const active = await this.deps.cache.getKv<string>(ACTIVE_SESSION_KV);
      if (!active) {
        const open = writes.filter((s) => !s.endedAt && s.itemIds.length > 0).sort((a, b) => b.clientUpdatedAt - a.clientUpdatedAt)[0];
        if (open) await this.deps.cache.putKv(ACTIVE_SESSION_KV, open.id);
      }
    }
    if (progress || sessions) this.notify();
    return { progress, sessions };
  }
}
