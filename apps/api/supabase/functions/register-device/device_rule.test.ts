import { assertEquals } from "@std/assert";
import { activeDevices, decideRegister, type DeviceSlotRow, SINGLE_DEVICE } from "../_shared/device-rule.ts";

const FP = (n: number) => n.toString(16).padStart(64, "0");
const active = (id: string, fp: number): DeviceSlotRow => ({ id, fingerprint_hash: FP(fp), removed_at: null });
const retired = (id: string, fp: number): DeviceSlotRow => ({ id, fingerprint_hash: FP(fp), removed_at: "2026-09-01T00:00:00Z" });

Deno.test("the registry holds exactly one active device (SPEC 5.3, 0015)", () => {
  assertEquals(SINGLE_DEVICE, true);
});

Deno.test("an unknown device takes the slot and signs the old one out", () => {
  const d = [active("laptop", 1)];
  const decision = decideRegister(d, FP(2));
  assertEquals(decision.reason, "new");
  assertEquals(decision.existing_id, null);
  assertEquals(decision.superseded.map((s) => s.id), ["laptop"]);
});

Deno.test("the laptop-then-phone case never dead-ends", () => {
  // the bug 0015 fixes: under the old 3-slot rule this path could answer 409 device_limit.
  let registry = [active("laptop", 1)];
  const toPhone = decideRegister(registry, FP(2));
  assertEquals(toPhone.superseded.map((s) => s.id), ["laptop"]);

  // phone now holds the slot, laptop retired
  registry = [retired("laptop", 1), active("phone", 2)];

  // and back to the laptop later, with no cooldown in the way
  const backToLaptop = decideRegister(registry, FP(1));
  assertEquals(backToLaptop.reason, "reactivate");
  assertEquals(backToLaptop.existing_id, "laptop");
  assertEquals(backToLaptop.superseded.map((s) => s.id), ["phone"]);
});

Deno.test("the same device signing in again supersedes nothing", () => {
  const decision = decideRegister([active("phone", 2)], FP(2));
  assertEquals(decision.reason, "already_active");
  assertEquals(decision.existing_id, "phone");
  assertEquals(decision.superseded, []);
});

Deno.test("a first-ever sign-in supersedes nothing", () => {
  const decision = decideRegister([], FP(1));
  assertEquals(decision.reason, "new");
  assertEquals(decision.superseded, []);
});

Deno.test("retired devices never hold a slot", () => {
  const d = [retired("a", 1), retired("b", 2), active("c", 3)];
  assertEquals(activeDevices(d).map((x) => x.id), ["c"]);
  // a third fingerprint displaces only the active one
  assertEquals(decideRegister(d, FP(4)).superseded.map((s) => s.id), ["c"]);
});
