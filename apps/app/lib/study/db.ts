/**
 * Local cache + offline outbox (V2 §1: the server is the source of truth; Dexie is a read cache and
 * write queue only). Dexie over IndexedDB works identically in the browser and in the Capacitor
 * webview. Clearing storage loses nothing that has reached the server.
 * Deviation from SPEC §8 ("SQLite"): recorded in docs/DECISIONS.md.
 */
import Dexie, { type Table } from "dexie";
import type { Progress, StudySession } from "./types.js";
import type { OutboxEntry } from "../state/types.js";
import type { Item } from "@rep/schema";

/** `batchId` / `expiresAt` are set for items issued by the API (SPEC §5.4 short-TTL batches). */
export interface CachedItem { id: string; bank: string; node: string; item: Item; cachedAt: number; batchId?: string; expiresAt?: number }
/**
 * kv keys in use: activeSession, studyState, repo.owner, auth.device, entitlement:<uid>, sync.pushedAfter, sync.since.
 * Everything learner-scoped is a CACHE of server rows (V2 §1); lib/state/repo.ts owns the writes.
 */
export interface KV { key: string; value: unknown }

export class StudyDb extends Dexie {
  items!: Table<CachedItem, string>;
  progress!: Table<Progress, string>;
  sessions!: Table<StudySession, string>;
  kv!: Table<KV, string>;
  /** offline write queue replayed against the server by lib/state/repo.ts */
  outbox!: Table<OutboxEntry, string>;
  constructor(name = "rep-study") {
    super(name);
    this.version(1).stores({
      items: "id, bank, node",
      progress: "itemId, bank, node, box, dueAt, leech, clientUpdatedAt",
      sessions: "id, kind, jurisdiction, endedAt, clientUpdatedAt",
      kv: "key",
    });
    this.version(2).stores({ outbox: "key, kind, at" });
  }
}

let db: StudyDb | null = null;
export function getDb(): StudyDb {
  if (!db) db = new StudyDb();
  return db;
}
