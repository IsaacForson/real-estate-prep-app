/**
 * Local-first store (SPEC F7/F8). Dexie over IndexedDB works identically in the browser and in the
 * Capacitor webview, so every study read hits local storage; sync is a background concern.
 * Deviation from SPEC §8 ("SQLite"): recorded in docs/DECISIONS.md.
 */
import Dexie, { type Table } from "dexie";
import type { Progress, StudySession } from "./types.js";
import type { Item } from "@rep/schema";

export interface CachedItem { id: string; bank: string; node: string; item: Item; cachedAt: number }
export interface KV { key: string; value: unknown }

export class StudyDb extends Dexie {
  items!: Table<CachedItem, string>;
  progress!: Table<Progress, string>;
  sessions!: Table<StudySession, string>;
  kv!: Table<KV, string>;
  constructor(name = "rep-study") {
    super(name);
    this.version(1).stores({
      items: "id, bank, node",
      progress: "itemId, bank, node, box, dueAt, leech, clientUpdatedAt",
      sessions: "id, kind, jurisdiction, endedAt, clientUpdatedAt",
      kv: "key",
    });
  }
}

let db: StudyDb | null = null;
export function getDb(): StudyDb {
  if (!db) db = new StudyDb();
  return db;
}
