/**
 * The repository's local side: a read cache plus the offline outbox. Two implementations:
 *   DexieCache  — IndexedDB via lib/study/db.ts (browser + Capacitor webview)
 *   MemoryCache — plain maps, for tests and for environments without IndexedDB
 * Nothing in here is authoritative (V2 §1): the server row always wins on hydrate, and the outbox
 * is replayed by the repo. Learner-scoped kv keys are prefixed so an account switch can clear them.
 */
import type { StudyDb } from "../study/db.js";
import type { Progress, StudySession } from "../study/types.js";
import type { OutboxEntry } from "./types.js";

/** kv keys that belong to the signed-in learner (cleared on account switch). */
export const LEARNER_KV_KEYS = ["activeSession", "studyState", "sync.pushedAfter", "sync.since", "freeTier"] as const;
/** kv key holding the uid whose data the cache currently mirrors. */
export const OWNER_KV_KEY = "repo.owner";

export interface CacheStore {
  getProgress(itemId: string): Promise<Progress | undefined>;
  getProgressMany(itemIds: string[]): Promise<Array<Progress | undefined>>;
  allProgress(): Promise<Progress[]>;
  progressByBank(bank: string): Promise<Progress[]>;
  putProgress(rows: Progress[]): Promise<void>;

  getSession(id: string): Promise<StudySession | undefined>;
  getSessionsMany(ids: string[]): Promise<Array<StudySession | undefined>>;
  allSessions(): Promise<StudySession[]>;
  putSessions(rows: StudySession[]): Promise<void>;

  getKv<T = unknown>(key: string): Promise<T | undefined>;
  putKv(key: string, value: unknown): Promise<void>;
  deleteKv(key: string): Promise<void>;

  outboxAll(): Promise<OutboxEntry[]>;
  outboxPut(entries: OutboxEntry[]): Promise<void>;
  outboxDelete(keys: string[]): Promise<void>;

  /** item metadata for progress rows the server knows but we never cached (bank/node). */
  itemMeta(ids: string[]): Promise<Map<string, { bank: string; node: string }>>;

  /** Wipe everything learner-scoped: progress, sessions, outbox, cached items and learner kv. */
  clearLearnerData(): Promise<void>;
}

/** Structured clone (IndexedDB) rejects Vue proxies and functions; always persist plain copies. */
export function plain<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

// ---- Dexie -------------------------------------------------------------------------------------

export class DexieCache implements CacheStore {
  constructor(private db: StudyDb) {}
  getProgress(itemId: string) { return this.db.progress.get(itemId); }
  getProgressMany(ids: string[]) { return this.db.progress.bulkGet(ids); }
  allProgress() { return this.db.progress.toArray(); }
  progressByBank(bank: string) { return this.db.progress.where("bank").equals(bank).toArray(); }
  async putProgress(rows: Progress[]) { if (rows.length) await this.db.progress.bulkPut(rows.map(plain)); }

  getSession(id: string) { return this.db.sessions.get(id); }
  getSessionsMany(ids: string[]) { return this.db.sessions.bulkGet(ids); }
  allSessions() { return this.db.sessions.toArray(); }
  async putSessions(rows: StudySession[]) { if (rows.length) await this.db.sessions.bulkPut(rows.map(plain)); }

  async getKv<T>(key: string) { return (await this.db.kv.get(key))?.value as T | undefined; }
  async putKv(key: string, value: unknown) { await this.db.kv.put({ key, value: plain(value) }); }
  async deleteKv(key: string) { await this.db.kv.delete(key); }

  outboxAll() { return this.db.outbox.toArray(); }
  async outboxPut(entries: OutboxEntry[]) { if (entries.length) await this.db.outbox.bulkPut(entries.map(plain)); }
  async outboxDelete(keys: string[]) { if (keys.length) await this.db.outbox.bulkDelete(keys); }

  async itemMeta(ids: string[]) {
    const out = new Map<string, { bank: string; node: string }>();
    for (const c of await this.db.items.bulkGet(ids)) if (c) out.set(c.id, { bank: c.bank, node: c.node });
    return out;
  }

  async clearLearnerData() {
    await this.db.transaction("rw", [this.db.progress, this.db.sessions, this.db.outbox, this.db.items, this.db.kv], async () => {
      await Promise.all([this.db.progress.clear(), this.db.sessions.clear(), this.db.outbox.clear(), this.db.items.clear()]);
      await this.db.kv.bulkDelete([...LEARNER_KV_KEYS]);
    });
  }
}

// ---- in-memory (tests) -------------------------------------------------------------------------

export class MemoryCache implements CacheStore {
  progress = new Map<string, Progress>();
  sessions = new Map<string, StudySession>();
  kv = new Map<string, unknown>();
  outbox = new Map<string, OutboxEntry>();
  items = new Map<string, { bank: string; node: string }>();

  async getProgress(id: string) { return this.progress.get(id); }
  async getProgressMany(ids: string[]) { return ids.map((id) => this.progress.get(id)); }
  async allProgress() { return [...this.progress.values()]; }
  async progressByBank(bank: string) { return [...this.progress.values()].filter((p) => p.bank === bank); }
  async putProgress(rows: Progress[]) { for (const r of rows) this.progress.set(r.itemId, plain(r)); }

  async getSession(id: string) { return this.sessions.get(id); }
  async getSessionsMany(ids: string[]) { return ids.map((id) => this.sessions.get(id)); }
  async allSessions() { return [...this.sessions.values()]; }
  async putSessions(rows: StudySession[]) { for (const r of rows) this.sessions.set(r.id, plain(r)); }

  async getKv<T>(key: string) { return this.kv.get(key) as T | undefined; }
  async putKv(key: string, value: unknown) { this.kv.set(key, plain(value)); }
  async deleteKv(key: string) { this.kv.delete(key); }

  async outboxAll() { return [...this.outbox.values()]; }
  async outboxPut(entries: OutboxEntry[]) { for (const e of entries) this.outbox.set(e.key, plain(e)); }
  async outboxDelete(keys: string[]) { for (const k of keys) this.outbox.delete(k); }

  async itemMeta(ids: string[]) {
    const out = new Map<string, { bank: string; node: string }>();
    for (const id of ids) { const m = this.items.get(id); if (m) out.set(id, m); }
    return out;
  }

  async clearLearnerData() {
    this.progress.clear(); this.sessions.clear(); this.outbox.clear(); this.items.clear();
    for (const k of LEARNER_KV_KEYS) this.kv.delete(k);
  }
}
