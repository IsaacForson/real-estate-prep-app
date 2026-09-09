import { assertEquals } from "@std/assert";
import { activeDevices, decideRegister, type DeviceSlotRow } from "../_shared/device-rule.ts";
import { DEFAULT_MAX_ACTIVE_DEVICES } from "../_shared/limits.ts";

const FP = (n: number) => n.toString(16).padStart(64, "0");
/** `seen` orders the slot queue: higher is more recent, so lower loses its slot first. */
const active = (id: string, fp: number, seen = 1): DeviceSlotRow => ({
  id,
  fingerprint_hash: FP(fp),
  removed_at: null,
  last_seen: new Date(Date.UTC(2026, 8, seen)).toISOString(),
});
const retired = (id: string, fp: number): DeviceSlotRow => ({ id, fingerprint_hash: FP(fp), removed_at: "2026-09-01T00:00:00Z" });

Deno.test("the shipped default is a single active device (SPEC 5.3, 0015)", () => {
  assertEquals(DEFAULT_MAX_ACTIVE_DEVICES, 1);
  // and the mirror defaults to it when no ceiling is passed
  assertEquals(decideRegister([active("laptop", 1)], FP(2)).superseded.map((s) => s.id), ["laptop"]);
});

Deno.test("at one slot, an unknown device takes it and signs the old one out", () => {
  const decision = decideRegister([active("laptop", 1)], FP(2), 1);
  assertEquals(decision.reason, "new");
  assertEquals(decision.existing_id, null);
  assertEquals(decision.superseded.map((s) => s.id), ["laptop"]);
});

Deno.test("the laptop-then-phone case never dead-ends", () => {
  // the bug 0015 fixed: under the old 3-slot rule with a cooldown this path answered 409.
  let registry = [active("laptop", 1)];
  assertEquals(decideRegister(registry, FP(2), 1).superseded.map((s) => s.id), ["laptop"]);

  // phone now holds the slot, laptop retired
  registry = [retired("laptop", 1), active("phone", 2)];

  // and back to the laptop later, with no cooldown in the way
  const backToLaptop = decideRegister(registry, FP(1), 1);
  assertEquals(backToLaptop.reason, "reactivate");
  assertEquals(backToLaptop.existing_id, "laptop");
  assertEquals(backToLaptop.superseded.map((s) => s.id), ["phone"]);
});

Deno.test("the same device signing in again supersedes nothing", () => {
  const decision = decideRegister([active("phone", 2)], FP(2), 1);
  assertEquals(decision.reason, "already_active");
  assertEquals(decision.existing_id, "phone");
  assertEquals(decision.superseded, []);
});

Deno.test("a first-ever sign-in supersedes nothing", () => {
  assertEquals(decideRegister([], FP(1), 1).superseded, []);
  assertEquals(decideRegister([], FP(1), 3).superseded, []);
});

Deno.test("retired devices never hold a slot", () => {
  const d = [retired("a", 1), retired("b", 2), active("c", 3)];
  assertEquals(activeDevices(d).map((x) => x.id), ["c"]);
  assertEquals(decideRegister(d, FP(4), 1).superseded.map((s) => s.id), ["c"]);
  // with room for three, the two retired rows do not count against the ceiling
  assertEquals(decideRegister(d, FP(4), 3).superseded, []);
});

Deno.test("raising the ceiling lets devices coexist until it is reached", () => {
  const phone = active("phone", 1, 1);
  const laptop = active("laptop", 2, 2);
  const tablet = active("tablet", 3, 3);

  // two held, room for three: a third device displaces nobody
  assertEquals(decideRegister([phone, laptop], FP(9), 3).superseded, []);

  // three held, room for three: the fourth pushes out only the least recently seen
  const full = decideRegister([phone, laptop, tablet], FP(9), 3);
  assertEquals(full.reason, "new");
  assertEquals(full.superseded.map((s) => s.id), ["phone"]);

  // an existing device signing in again keeps its own slot, so nothing moves
  assertEquals(decideRegister([phone, laptop, tablet], FP(2), 3).superseded, []);
});

Deno.test("lowering the ceiling collapses the extra slots on the next sign-in", () => {
  const registry = [active("phone", 1, 1), active("laptop", 2, 2), active("tablet", 3, 3)];
  // an admin drops the setting back to 1; the next sign-in retires everything else
  const decision = decideRegister(registry, FP(9), 1);
  assertEquals(decision.superseded.map((s) => s.id), ["tablet", "laptop", "phone"]);
  // even for a device that already had a slot
  assertEquals(decideRegister(registry, FP(2), 1).superseded.map((s) => s.id), ["tablet", "phone"]);
});

Deno.test("a nonsense ceiling degrades to one slot rather than unlimited", () => {
  const registry = [active("phone", 1, 1), active("laptop", 2, 2)];
  for (const bad of [0, -5, 0.4, Number.NaN]) {
    assertEquals(decideRegister(registry, FP(9), bad).superseded.length, 2, `ceiling ${bad}`);
  }
});
