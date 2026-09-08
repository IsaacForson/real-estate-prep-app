/**
 * SPEC §5.3 device rule, pure typescript. The authoritative enforcement is fn_register_device in
 * sql (atomic, advisory-locked); this mirror exists so the rule is unit-tested and so the edge
 * function can produce a precise error payload ("slot frees up on <date>") before calling sql.
 */
import { DEVICE_COOLDOWN_DAYS, MAX_ACTIVE_DEVICES } from "./limits.ts";

export interface DeviceSlotRow {
  id: string;
  fingerprint_hash: string;
  removed_at: string | null;
  cooldown_until: string | null;
}

/** An active device, or a removed one whose 7-day cooldown has not elapsed, occupies a slot. */
export function occupiesSlot(d: DeviceSlotRow, now: Date): boolean {
  if (d.removed_at === null) return true;
  if (d.cooldown_until === null) return false;
  return Date.parse(d.cooldown_until) > now.getTime();
}

export function occupiedSlotCount(devices: DeviceSlotRow[], now: Date): number {
  return devices.filter((d) => occupiesSlot(d, now)).length;
}

export type RegisterDecision =
  | { ok: true; reason: "already_active" | "reactivate" | "new"; existing_id: string | null }
  | { ok: false; reason: "device_limit"; occupied: number; next_slot_frees_at: string | null };

export function decideRegister(
  devices: DeviceSlotRow[],
  fingerprintHash: string,
  now: Date,
  max = MAX_ACTIVE_DEVICES,
): RegisterDecision {
  const same = devices.find((d) => d.fingerprint_hash === fingerprintHash) ?? null;
  if (same && same.removed_at === null) {
    return { ok: true, reason: "already_active", existing_id: same.id };
  }
  const occupied = occupiedSlotCount(devices, now);
  if (occupied < max) {
    return { ok: true, reason: same ? "reactivate" : "new", existing_id: same?.id ?? null };
  }
  // all slots taken. tell the user when the earliest cooling-down slot frees (null = all active,
  // so they must remove one themselves).
  const cooling = devices
    .filter((d) => d.removed_at !== null && occupiesSlot(d, now))
    .map((d) => Date.parse(d.cooldown_until!))
    .sort((a, b) => a - b);
  return {
    ok: false,
    reason: "device_limit",
    occupied,
    next_slot_frees_at: cooling.length ? new Date(cooling[0]!).toISOString() : null,
  };
}

export function removalCooldownUntil(now: Date, days = DEVICE_COOLDOWN_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
export const PLATFORMS = ["ios", "android", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];
export function isPlatform(x: unknown): x is Platform {
  return typeof x === "string" && (PLATFORMS as readonly string[]).includes(x);
}
