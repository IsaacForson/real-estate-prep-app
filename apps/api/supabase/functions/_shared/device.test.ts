import { assertEquals } from "@std/assert";
import { deviceHashFromHeaders, effectiveFreeTier } from "./device.ts";
import { FREE_TIER_ITEMS, FREE_TIER_MOCKS } from "./limits.ts";

const base = {
  userQuestions: 0,
  userMocks: 0,
  deviceQuestions: 0,
  deviceMocks: 0,
  deviceBlocked: false,
  deviceExhausted: false,
};

Deno.test("fresh account on a fresh device: the full free tier", () => {
  const f = effectiveFreeTier(base);
  assertEquals(f.questions_remaining, FREE_TIER_ITEMS);
  assertEquals(f.mocks_remaining, FREE_TIER_MOCKS);
  assertEquals(f.exhausted, false);
  assertEquals(f.reason, "ok");
});

Deno.test("V2 §1: a new email on a used device inherits the device's consumption (max of both)", () => {
  const f = effectiveFreeTier({ ...base, userQuestions: 0, deviceQuestions: 35, deviceMocks: 1 });
  assertEquals(f.questions_used, 35);
  assertEquals(f.questions_remaining, 5);
  assertEquals(f.mocks_remaining, 0);
  assertEquals(f.exhausted, false);
  assertEquals(f.reason, "mocks");
  // and the other way round: an account that studied elsewhere brings its usage to a new device
  const g = effectiveFreeTier({ ...base, userQuestions: 40, deviceQuestions: 3 });
  assertEquals(g.questions_remaining, 0);
  assertEquals(g.exhausted, true);
  assertEquals(g.reason, "questions");
});

Deno.test("legacy client without a device hash: only the account counts", () => {
  const f = effectiveFreeTier({ ...base, userQuestions: 10, deviceQuestions: null, deviceMocks: null });
  assertEquals(f.questions_remaining, 30);
  assertEquals(f.reason, "ok");
});

Deno.test("blocked or shared (≥3 accounts / 30d) devices have no free tier at all", () => {
  const blocked = effectiveFreeTier({ ...base, deviceBlocked: true });
  assertEquals(blocked.questions_remaining, 0);
  assertEquals(blocked.mocks_remaining, 0);
  assertEquals(blocked.exhausted, true);
  assertEquals(blocked.reason, "device_blocked");
  const shared = effectiveFreeTier({ ...base, deviceExhausted: true, userQuestions: 2 });
  assertEquals(shared.reason, "device_shared");
  assertEquals(shared.questions_used, 2); // usage still reported honestly
});

Deno.test("negative / non-finite counters are treated as zero; custom limits honoured", () => {
  const f = effectiveFreeTier({
    ...base,
    userQuestions: -5,
    deviceQuestions: Number.NaN,
    limits: { questions: 10, mocks: 2 },
  });
  assertEquals(f.questions_remaining, 10);
  assertEquals(f.mocks_remaining, 2);
  assertEquals(f.total, 10);
});

Deno.test("deviceHashFromHeaders accepts sha256 hex only", () => {
  const good = "a".repeat(64);
  assertEquals(deviceHashFromHeaders(new Headers({ "x-device-hash": good.toUpperCase() })), good);
  assertEquals(deviceHashFromHeaders(new Headers({ "x-device-hash": "abc" })), null);
  assertEquals(deviceHashFromHeaders(new Headers()), null);
});
