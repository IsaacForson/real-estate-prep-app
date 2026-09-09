import { assertEquals } from "@std/assert";
import { activeDevices, decideRegister, type DeviceSlotRow } from "../_shared/device-rule.ts";

const FP = (n: number) => n.toString(16).padStart(64, "0");

Deno.test("removal frees the slot immediately (no cooldown since 0015)", () => {
  const removed: DeviceSlotRow[] = [{ id: "phone", fingerprint_hash: FP(1), removed_at: new Date().toISOString() }];
  assertEquals(activeDevices(removed), []);

  // the removed device can sign straight back in, and so can a brand new one
  assertEquals(decideRegister(removed, FP(1)).reason, "reactivate");
  assertEquals(decideRegister(removed, FP(2)).reason, "new");
  assertEquals(decideRegister(removed, FP(2)).superseded, []);
});
