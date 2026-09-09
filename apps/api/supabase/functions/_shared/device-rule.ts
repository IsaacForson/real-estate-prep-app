/**
 * SPEC §5.3 device rule, pure typescript. The authoritative enforcement is fn_register_device in
 * sql (atomic, advisory-locked); this mirror exists so the rule is unit-tested and so the edge
 * function can tell the client which devices the sign-in just signed out.
 *
 * The ceiling is `app_settings.device_policy.max_active_devices` (0016), read by the edge function
 * and passed in here — this module stays pure so it can be tested at every ceiling.
 *
 * At 1 (the shipped default) an unknown fingerprint always wins the only slot: the device that held
 * it is retired and its session revoked. Above 1, devices accumulate until the ceiling is reached
 * and only then does the least recently seen one lose its slot. Registration is never refused at
 * any ceiling, so there is no device_limit decision and no removal cooldown.
 */
import { DEFAULT_MAX_ACTIVE_DEVICES } from "./limits.ts";

export interface DeviceSlotRow {
  id: string;
  fingerprint_hash: string;
  removed_at: string | null;
  /** used to decide which device loses its slot first; missing sorts oldest. */
  last_seen?: string | null;
}

export function activeDevices(devices: DeviceSlotRow[]): DeviceSlotRow[] {
  return devices.filter((d) => d.removed_at === null);
}

/** Most recently seen first, which is the order fn_enforce_device_limit keeps slots in. */
function byRecency(devices: DeviceSlotRow[]): DeviceSlotRow[] {
  return [...devices].sort((a, b) => {
    const ta = a.last_seen ? Date.parse(a.last_seen) : 0;
    const tb = b.last_seen ? Date.parse(b.last_seen) : 0;
    return tb - ta;
  });
}

export interface RegisterDecision {
  /** "already_active" = same device again, "reactivate" = a retired device returning, "new" = first sight. */
  reason: "already_active" | "reactivate" | "new";
  existing_id: string | null;
  /** active devices that lose their slot to this sign-in (empty when there is room for everyone). */
  superseded: DeviceSlotRow[];
}

export function decideRegister(
  devices: DeviceSlotRow[],
  fingerprintHash: string,
  maxActive: number = DEFAULT_MAX_ACTIVE_DEVICES,
): RegisterDecision {
  const ceiling = Math.max(1, Math.floor(maxActive));
  const same = devices.find((d) => d.fingerprint_hash === fingerprintHash) ?? null;
  const incomingId = same?.id ?? null;

  // the device signing in always keeps a slot, so the others are competing for `ceiling - 1`.
  const others = byRecency(activeDevices(devices).filter((d) => d.id !== incomingId));
  const superseded = others.slice(ceiling - 1);

  return {
    reason: same ? (same.removed_at === null ? "already_active" : "reactivate") : "new",
    existing_id: incomingId,
    superseded,
  };
}

export const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
export const PLATFORMS = ["ios", "android", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];
export function isPlatform(x: unknown): x is Platform {
  return typeof x === "string" && (PLATFORMS as readonly string[]).includes(x);
}
