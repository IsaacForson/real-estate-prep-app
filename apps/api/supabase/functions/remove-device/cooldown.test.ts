import { assertEquals } from "@std/assert";
import { decideRegister, occupiesSlot, removalCooldownUntil } from "../_shared/device-rule.ts";
import { DEVICE_COOLDOWN_DAYS } from "../_shared/limits.ts";

Deno.test("removal cooldown is exactly 7 days (SPEC 5.3)", () => {
  assertEquals(DEVICE_COOLDOWN_DAYS, 7);
  const now = new Date("2026-09-08T12:00:00Z");
  assertEquals(removalCooldownUntil(now).toISOString(), "2026-09-15T12:00:00.000Z");
});

Deno.test("removing a device does not free its slot immediately", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  const fp = (n: number) => n.toString(16).padStart(64, "0");
  const removedNow = {
    id: "c",
    fingerprint_hash: fp(3),
    removed_at: now.toISOString(),
    cooldown_until: removalCooldownUntil(now).toISOString(),
  };
  const devices = [
    { id: "a", fingerprint_hash: fp(1), removed_at: null, cooldown_until: null },
    { id: "b", fingerprint_hash: fp(2), removed_at: null, cooldown_until: null },
    removedNow,
  ];
  assertEquals(occupiesSlot(removedNow, now), true);
  assertEquals(decideRegister(devices, fp(4), now).ok, false);
  assertEquals(decideRegister(devices, fp(4), new Date("2026-09-15T12:00:01Z")).ok, true);
});
