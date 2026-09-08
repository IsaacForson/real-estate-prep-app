import { assertEquals } from "@std/assert";
import { decideRegister, type DeviceSlotRow, occupiedSlotCount, occupiesSlot } from "../_shared/device-rule.ts";

const now = new Date("2026-09-08T12:00:00Z");
const FP = (n: number) => n.toString(16).padStart(64, "0");
const active = (id: string, fp: number): DeviceSlotRow => ({
  id,
  fingerprint_hash: FP(fp),
  removed_at: null,
  cooldown_until: null,
});
const removed = (id: string, fp: number, until: string): DeviceSlotRow => ({
  id,
  fingerprint_hash: FP(fp),
  removed_at: "2026-09-01T00:00:00Z",
  cooldown_until: until,
});

Deno.test("occupiesSlot: active always; removed only while cooling down", () => {
  assertEquals(occupiesSlot(active("a", 1), now), true);
  assertEquals(occupiesSlot(removed("b", 2, "2026-09-09T00:00:00Z"), now), true);
  assertEquals(occupiesSlot(removed("c", 3, "2026-09-08T11:59:59Z"), now), false);
});

Deno.test("phone + tablet + laptop never hits the limit (SPEC 5.3)", () => {
  const d = [active("phone", 1), active("tablet", 2)];
  assertEquals(decideRegister(d, FP(3), now).ok, true);
  assertEquals(occupiedSlotCount(d, now), 2);
});

Deno.test("a fourth distinct device is refused; same device re-login is fine", () => {
  const d = [active("a", 1), active("b", 2), active("c", 3)];
  const refused = decideRegister(d, FP(4), now);
  assertEquals(refused.ok, false);
  if (!refused.ok) {
    assertEquals(refused.occupied, 3);
    assertEquals(refused.next_slot_frees_at, null); // all active: user must remove one
  }
  const again = decideRegister(d, FP(2), now);
  assertEquals(again, { ok: true, reason: "already_active", existing_id: "b" });
});

Deno.test("a removed device keeps its slot for 7 days, then frees it", () => {
  const d = [active("a", 1), active("b", 2), removed("c", 3, "2026-09-10T00:00:00Z")];
  const refused = decideRegister(d, FP(4), now);
  assertEquals(refused.ok, false);
  if (!refused.ok) assertEquals(refused.next_slot_frees_at, "2026-09-10T00:00:00.000Z");
  const later = new Date("2026-09-10T00:00:01Z");
  assertEquals(decideRegister(d, FP(4), later), { ok: true, reason: "new", existing_id: null });
  // the removed device itself can come back once the slot is free
  assertEquals(decideRegister(d, FP(3), later), { ok: true, reason: "reactivate", existing_id: "c" });
});
