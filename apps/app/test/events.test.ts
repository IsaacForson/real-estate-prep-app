import { describe, it, expect } from "vitest";
import { MemoryCache } from "../lib/state/cache.js";
import { EVENT_BATCH, EVENT_MAX_ATTEMPTS, EventQueue, sanitizeProps } from "../lib/state/events.js";
import type { WireEvent } from "../lib/state/types.js";

const T0 = 1_800_000_000_000;

function setup(o: { fail?: () => boolean } = {}) {
  const cache = new MemoryCache();
  const sent: WireEvent[][] = [];
  let n = 0, clock = T0;
  const q = new EventQueue({
    cache,
    send: async (events) => { if (o.fail?.()) throw new TypeError("Failed to fetch"); sent.push(events); },
    now: () => clock++,
    randomId: () => `id${n++}`,
  });
  return { cache, sent, q };
}

describe("events: queue + batch", () => {
  it("track() is synchronous, persists to the outbox and flush() sends in batches of 50, oldest first", async () => {
    const { cache, sent, q } = setup();
    for (let i = 0; i < 120; i++) q.track("answer", { i });
    await new Promise((r) => setTimeout(r, 0));
    expect((await cache.outboxAll()).filter((e) => e.kind === "event")).toHaveLength(120);
    const r = await q.flush();
    expect(r).toEqual({ sent: 120, failed: 0 });
    expect(sent.map((b) => b.length)).toEqual([EVENT_BATCH, EVENT_BATCH, 20]);
    expect(sent[0]![0]).toMatchObject({ kind: "answer", props: { i: 0 }, at: new Date(T0).toISOString() });
    expect(sent[2]![19]!.props.i).toBe(119);
    expect(await cache.outboxAll()).toHaveLength(0);
  });

  it("keeps everything queued when the endpoint fails and retries later without duplicates", async () => {
    let failing = true;
    const { cache, sent, q } = setup({ fail: () => failing });
    q.track("app_open"); q.track("sign_in", { restored: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(await q.flush()).toEqual({ sent: 0, failed: 2 });
    const pending = await cache.outboxAll();
    expect(pending).toHaveLength(2);
    expect(pending.every((e) => e.attempts === 1)).toBe(true);
    failing = false;
    q.track("settings_changed", { keys: ["examDate"] });
    await new Promise((r) => setTimeout(r, 0));
    expect(await q.flush()).toEqual({ sent: 3, failed: 0 });
    expect(sent.flat().map((e) => e.kind)).toEqual(["app_open", "sign_in", "settings_changed"]);
  });

  it("drops events that failed too many times so the queue never grows forever", async () => {
    const { cache, q } = setup({ fail: () => true });
    q.track("answer");
    await new Promise((r) => setTimeout(r, 0));
    await cache.outboxPut((await cache.outboxAll()).map((e) => ({ ...e, attempts: EVENT_MAX_ATTEMPTS })));
    expect(await q.flush()).toEqual({ sent: 0, failed: 0 });
    expect(await cache.outboxAll()).toHaveLength(0);
  });

  it("sanitizes props for jsonb (drops functions/undefined, truncates long strings)", () => {
    const out = sanitizeProps({ a: 1, b: "x".repeat(600), c: undefined, d: () => 1, e: { nested: true }, f: null });
    expect(out).toEqual({ a: 1, b: "x".repeat(512), e: { nested: true }, f: null });
  });
});
