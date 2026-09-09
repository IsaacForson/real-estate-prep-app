/**
 * Learner events (V2 §2/§3): `track()` is fire-and-forget into the Dexie outbox; `useSync` flushes
 * batches to `track-event`. Every event carries the platform; the device hash rides in the header.
 */
import { DexieCache, MemoryCache } from "~~/lib/state/cache";
import { EventQueue } from "~~/lib/state/events";
import type { EventKind } from "~~/lib/state/types";
import { getDb } from "~~/lib/study/db";

let queue: EventQueue | null = null;

export function useEvents() {
  const { remote } = useRepo();
  const platform = platformName();
  if (!queue) {
    queue = new EventQueue({
      cache: import.meta.client ? new DexieCache(getDb()) : new MemoryCache(),
      send: async (events) => {
        if (!remote) return; // static dev mode: nobody is listening
        await remote.trackEvents(events);
      },
    });
  }
  const q = queue;

  function track(kind: EventKind, props: Record<string, unknown> = {}): void {
    if (!import.meta.client) return;
    q.track(kind, { platform, ...props });
  }

  /** Send what is queued (called by useSync; safe to call directly before sign-out). */
  function flush() { return q.flush(); }

  return { track, flush };
}
