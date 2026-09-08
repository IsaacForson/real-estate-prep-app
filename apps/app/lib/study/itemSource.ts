/**
 * Where items come from. Dev/web preview: a static JSON built from the content repo + fixtures.
 * Production: signed session batches from the API (SPEC §5.4) — never the whole bank.
 */
import type { Item } from "@rep/schema";

export interface ItemSource {
  /** Item ids available for a bank (for scheduling). May be a rolling window, not the whole bank. */
  ids(bank: string): Promise<string[]>;
  /** Fetch items by id (from cache or network). */
  get(ids: string[]): Promise<Item[]>;
}

export class StaticItemSource implements ItemSource {
  private all: Promise<Item[]> | null = null;
  constructor(private url: string) {}
  private load() {
    if (!this.all) this.all = fetch(this.url).then((r) => (r.ok ? (r.json() as Promise<Item[]>) : []));
    return this.all;
  }
  async ids(bank: string) { return (await this.load()).filter((i) => i.bank === bank).map((i) => i.id); }
  async get(ids: string[]) { const set = new Set(ids); return (await this.load()).filter((i) => set.has(i.id)); }
}

/** Placeholder for the server-paced source. Wire to apps/api `issue-batch` once the backend is up. */
export class ApiItemSource implements ItemSource {
  constructor(private base: string, private token: () => string | null) {}
  async ids(_bank: string): Promise<string[]> { throw new Error("ApiItemSource.ids: not implemented — issue-batch returns a rolling window"); }
  async get(_ids: string[]): Promise<Item[]> { throw new Error("ApiItemSource.get: not implemented"); }
}
