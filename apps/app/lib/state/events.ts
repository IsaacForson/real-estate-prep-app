/**
 * Client analytics events (V2 §2 `events`, §3 `track-event`). `track()` is synchronous and cheap:
 * it appends to memory and to the cache outbox (kind `event`) so nothing is lost offline or on a
 * kill. `flush()` sends batches of at most EVENT_BATCH to `track-event`; entries are removed only
 * after the server accepted them. Pure apart from the injected cache + sender, so it is unit-tested.
 */
import type { CacheStore } from "./cache.js";
import type { EventKind, OutboxEntry, WireEvent } from "./types.js";

export const EVENT_BATCH = 50;
/** Keep the queue bounded even if the endpoint is down for days. */
export const EVENT_QUEUE_MAX = 2000;
export const EVENT_MAX_ATTEMPTS = 20;

export interface EventQueueDeps {
  cache: CacheStore;
  /** POST track-event; resolves when accepted, throws otherwise. Null = not signed in / offline. */
  send: (events: WireEvent[]) => Promise<void>;
  now?: () => number;
  randomId?: () => string;
}

export function eventKey(id: string): string { return `event:${id}`; }

export class EventQueue {
  private flushing: Promise<{ sent: number; failed: number }> | null = null;
  constructor(private deps: EventQueueDeps) {}
  private now() { return (this.deps.now ?? Date.now)(); }

  /** Fire-and-forget; the outbox write is awaited internally but never surfaces to callers. */
  track(kind: EventKind, props: Record<string, unknown> = {}): WireEvent {
    const ev: WireEvent = { kind, props: sanitizeProps(props), at: new Date(this.now()).toISOString() };
    const entry: OutboxEntry = { key: eventKey((this.deps.randomId ?? (() => crypto.randomUUID()))()), kind: "event", payload: ev, at: this.now(), attempts: 0 };
    void this.deps.cache.outboxPut([entry]).catch(() => { /* storage unavailable: the event is lost, the app is not */ });
    return ev;
  }

  /** Pending events, oldest first. */
  async pending(): Promise<OutboxEntry[]> {
    return (await this.deps.cache.outboxAll()).filter((e) => e.kind === "event").sort((a, b) => a.at - b.at);
  }

  /** Send everything queued in batches; stops at the first failed batch (order is preserved). */
  flush(): Promise<{ sent: number; failed: number }> {
    if (this.flushing) return this.flushing;
    this.flushing = this.run().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async run(): Promise<{ sent: number; failed: number }> {
    let all = await this.pending();
    // trim the oldest beyond the cap and drop entries that failed too often
    const drop = [...all.slice(0, Math.max(0, all.length - EVENT_QUEUE_MAX)), ...all.filter((e) => e.attempts >= EVENT_MAX_ATTEMPTS)];
    if (drop.length) { await this.deps.cache.outboxDelete(drop.map((e) => e.key)); const gone = new Set(drop.map((e) => e.key)); all = all.filter((e) => !gone.has(e.key)); }
    let sent = 0;
    for (let i = 0; i < all.length; i += EVENT_BATCH) {
      const batch = all.slice(i, i + EVENT_BATCH);
      try {
        await this.deps.send(batch.map((e) => e.payload as WireEvent));
        await this.deps.cache.outboxDelete(batch.map((e) => e.key));
        sent += batch.length;
      } catch {
        await this.deps.cache.outboxPut(batch.map((e) => ({ ...e, attempts: e.attempts + 1 })));
        return { sent, failed: all.length - sent };
      }
    }
    return { sent, failed: 0 };
  }
}

/** Props are jsonb on the server: keep them small, flat-ish and serialisable. */
export function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || typeof v === "function" || n >= 32) continue;
    if (typeof v === "string") out[k] = v.length > 512 ? v.slice(0, 512) : v;
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else { try { out[k] = JSON.parse(JSON.stringify(v)); } catch { continue; } }
    n++;
  }
  return out;
}
