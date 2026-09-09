/**
 * SPEC §5.3 device rule, pure typescript. The authoritative enforcement is fn_register_device in
 * sql (atomic, advisory-locked); this mirror exists so the rule is unit-tested and so the edge
 * function can tell the client which devices the sign-in just signed out.
 *
 * One active device per account. An unknown fingerprint always wins the slot — the devices that
 * held it are retired and their sessions revoked. Registration is never refused, so there is no
 * device_limit decision and no removal cooldown.
 */
import { MAX_ACTIVE_DEVICES } from "./limits.ts";

export interface DeviceSlotRow {
  id: string;
  fingerprint_hash: string;
  removed_at: string | null;
}

export function activeDevices(devices: DeviceSlotRow[]): DeviceSlotRow[] {
  return devices.filter((d) => d.removed_at === null);
}

export interface RegisterDecision {
  /** "already_active" = same device again, "reactivate" = a retired device returning, "new" = first sight. */
  reason: "already_active" | "reactivate" | "new";
  existing_id: string | null;
  /** active devices that lose the slot to this sign-in (empty when the device is already the active one). */
  superseded: DeviceSlotRow[];
}

export function decideRegister(
  devices: DeviceSlotRow[],
  fingerprintHash: string,
  _now: Date = new Date(),
): RegisterDecision {
  const same = devices.find((d) => d.fingerprint_hash === fingerprintHash) ?? null;
  if (same && same.removed_at === null) {
    // the slot holder is signing in again; anything else active is stale data but still loses it.
    return {
      reason: "already_active",
      existing_id: same.id,
      superseded: activeDevices(devices).filter((d) => d.id !== same.id),
    };
  }
  return {
    reason: same ? "reactivate" : "new",
    existing_id: same?.id ?? null,
    superseded: activeDevices(devices),
  };
}

/** Sanity guard for the mirror above: the takeover rule only makes sense at one slot. */
export const SINGLE_DEVICE = MAX_ACTIVE_DEVICES === 1;

export const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
export const PLATFORMS = ["ios", "android", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];
export function isPlatform(x: unknown): x is Platform {
  return typeof x === "string" && (PLATFORMS as readonly string[]).includes(x);
}
