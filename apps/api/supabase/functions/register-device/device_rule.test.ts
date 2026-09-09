import { assertEquals } from "@std/assert";
import { activeDevices, byRecency, decideRegister, type DeviceSlotRow } from "../_shared/device-rule.ts";
import { DEFAULT_MAX_ACTIVE_DEVICES } from "../_shared/limits.ts";
import { describeRevocation } from "../_shared/session-revoked.ts";

const FP = (n: number) => n.toString(16).padStart(64, "0");
const day = (n: number) => new Date(Date.UTC(2026, 8, n)).toISOString();
/** `seen` orders the slot queue: higher is more recent, so lower loses its slot first. */
const active = (id: string, fp: number, seen = 1, first = seen): DeviceSlotRow => ({
  id,
  fingerprint_hash: FP(fp),
  removed_at: null,
  last_seen: day(seen),
  first_seen: day(first),
});
const retired = (id: string, fp: number): DeviceSlotRow => ({
  id,
  fingerprint_hash: FP(fp),
  removed_at: "2026-09-01T00:00:00Z",
});

Deno.test("the shipped default is two active devices (0022)", () => {
  assertEquals(DEFAULT_MAX_ACTIVE_DEVICES, 2);
  // with one device held a second one displaces nobody
  assertEquals(decideRegister([active("laptop", 1)], FP(2)).superseded, []);
  // a third pushes out exactly one: the oldest
  assertEquals(decideRegister([active("laptop", 1, 1), active("phone", 2, 2)], FP(3)).superseded.map((s) => s.id), [
    "laptop",
  ]);
});

Deno.test("a third device evicts the least recently seen, never the newest", () => {
  const registry = [active("phone", 1, 3), active("laptop", 2, 1), active("tablet", 3, 2)];
  // ceiling 2 with three held (admin lowered it): the newcomer keeps a slot, the two oldest go, oldest first
  const decision = decideRegister(registry, FP(9), 2);
  assertEquals(decision.reason, "new");
  assertEquals(decision.superseded.map((s) => s.id), ["laptop", "tablet"]);
  // ceiling 3: only the single oldest
  assertEquals(decideRegister(registry, FP(9), 3).superseded.map((s) => s.id), ["laptop"]);
});

Deno.test("ties on last_seen fall to the device first seen longest ago", () => {
  const registry = [active("older", 1, 5, 1), active("newer", 2, 5, 4)];
  assertEquals(decideRegister(registry, FP(9), 2).superseded.map((s) => s.id), ["older"]);
  assertEquals(byRecency(registry).map((d) => d.id), ["newer", "older"]);
});

Deno.test("the same device signing in again reuses its slot and evicts nothing", () => {
  const registry = [active("phone", 1, 1), active("laptop", 2, 2)];
  const again = decideRegister(registry, FP(1), 2);
  assertEquals(again.reason, "already_active");
  assertEquals(again.existing_id, "phone");
  assertEquals(again.superseded, []);
  // even when the account is over a ceiling an admin has since lowered
  assertEquals(decideRegister([...registry, active("tablet", 3, 3)], FP(2), 1).superseded, []);
});

Deno.test("a previously evicted device coming back counts as a new sign-in", () => {
  const registry = [retired("laptop", 1), active("phone", 2, 2), active("tablet", 3, 3)];
  const back = decideRegister(registry, FP(1), 2);
  assertEquals(back.reason, "reactivate");
  assertEquals(back.existing_id, "laptop");
  assertEquals(back.superseded.map((s) => s.id), ["phone"]);
});

Deno.test("a first-ever sign-in supersedes nothing", () => {
  assertEquals(decideRegister([], FP(1), 1).superseded, []);
  assertEquals(decideRegister([], FP(1), 3).superseded, []);
});

Deno.test("retired devices never hold a slot", () => {
  const d = [retired("a", 1), retired("b", 2), active("c", 3)];
  assertEquals(activeDevices(d).map((x) => x.id), ["c"]);
  assertEquals(decideRegister(d, FP(4), 1).superseded.map((s) => s.id), ["c"]);
  assertEquals(decideRegister(d, FP(4), 2).superseded, []);
});

Deno.test("at one slot, an unknown device takes it and signs the old one out", () => {
  const decision = decideRegister([active("laptop", 1)], FP(2), 1);
  assertEquals(decision.reason, "new");
  assertEquals(decision.existing_id, null);
  assertEquals(decision.superseded.map((s) => s.id), ["laptop"]);
});

Deno.test("a nonsense ceiling degrades to one slot rather than unlimited", () => {
  const registry = [active("phone", 1, 1), active("laptop", 2, 2)];
  for (const bad of [0, -5, 0.4, Number.NaN]) {
    assertEquals(decideRegister(registry, FP(9), bad).superseded.length, 2, `ceiling ${bad}`);
  }
});

Deno.test("an evicted session is explained: who, what platform, when", () => {
  const r = describeRevocation(
    { revoked_at: "2026-09-09T10:00:00Z", revoke_reason: "new_device", revoked_by_device_id: "dev-2" },
    { name: "Chrome on Mac", platform: "web" },
    2,
  );
  assertEquals(r.reason, "new_device");
  assertEquals(r.details, {
    new_device_name: "Chrome on Mac",
    new_device_platform: "web",
    at: "2026-09-09T10:00:00Z",
    max_active_devices: 2,
  });
  assertEquals(
    r.message,
    "You were signed out because your account signed in on Chrome on Mac at 2026-09-09T10:00:00Z. Up to 2 devices can be active; you can manage devices in Account.",
  );
});

Deno.test("other revocations map to their own reasons", () => {
  const removed = describeRevocation(
    { revoked_at: "2026-09-09T10:00:00Z", revoke_reason: "device_removed", revoked_by_device_id: null },
    null,
    2,
  );
  assertEquals(removed.reason, "device_removed");
  // device retired without its session being touched still reads as removed
  const retiredOnly = describeRevocation(
    { revoked_at: null, revoke_reason: null, revoked_by_device_id: null, device_removed_at: "2026-09-09T10:00:00Z" },
    null,
    2,
  );
  assertEquals(retiredOnly.reason, "device_removed");
  assertEquals(
    describeRevocation({ revoked_at: "x", revoke_reason: "admin_disabled", revoked_by_device_id: null }, null, 2)
      .reason,
    "admin_disabled",
  );
  const shadow = describeRevocation(
    {
      revoked_at: null,
      revoke_reason: null,
      revoked_by_device_id: null,
      is_shadow: true,
      expires_at: "2026-09-09T09:00:00Z",
    },
    null,
    2,
    new Date("2026-09-09T10:00:00Z"),
  );
  assertEquals(shadow.reason, "expired");
  assertEquals(describeRevocation(null, null, 2).reason, "unknown");
});
