/**
 * SPEC §5.3 device rule, pure typescript. The authoritative enforcement is fn_register_device in
 * sql (atomic, advisory-locked); this mirror exists so the rule is unit-tested and so the edge
 * function can tell the client which devices the sign-in is about to sign out.
 *
 * The ceiling is `app_settings.device_policy.max_active_devices` (0016), read by the edge function
 * and passed in here — this module stays pure so it can be tested at every ceiling.
 *
 * Since 0022 (default 2): devices accumulate until the ceiling is reached; a sign-in from a device
 * that does not already hold a slot then evicts the least recently seen one (tie: the one first seen
 * longest ago). A device that already holds a slot signing in again evicts nothing, ever — even when
 * an admin has lowered the ceiling since. Registration is never refused at any ceiling, so there is
 * no device_limit decision and no removal cooldown.
 */
import { DEFAULT_MAX_ACTIVE_DEVICES } from "./limits.ts";

export interface DeviceSlotRow {
  id: string;
  fingerprint_hash: string;
  removed_at: string | null;
  /** decides which device loses its slot first; missing sorts oldest. */
  last_seen?: string | null;
  /** tie-breaker for last_seen; missing sorts oldest. */
  first_seen?: string | null;
}

export function activeDevices(devices: DeviceSlotRow[]): DeviceSlotRow[] {
  return devices.filter((d) => d.removed_at === null);
}

const ts = (s: string | null | undefined): number => (s ? Date.parse(s) || 0 : 0);

/** Most recently seen first (tie: most recently first seen), the order fn_evict_over_limit keeps slots in. */
export function byRecency(devices: DeviceSlotRow[]): DeviceSlotRow[] {
  return [...devices].sort((a, b) => (ts(b.last_seen) - ts(a.last_seen)) || (ts(b.first_seen) - ts(a.first_seen)));
}

export interface RegisterDecision {
  /** "already_active" = same device again, "reactivate" = a retired device returning, "new" = first sight. */
  reason: "already_active" | "reactivate" | "new";
  existing_id: string | null;
  /** active devices that lose their slot to this sign-in, oldest first (empty when nothing moves). */
  superseded: DeviceSlotRow[];
}

export function decideRegister(
  devices: DeviceSlotRow[],
  fingerprintHash: string,
  maxActive: number = DEFAULT_MAX_ACTIVE_DEVICES,
): RegisterDecision {
  const ceiling = Number.isFinite(maxActive) ? Math.max(1, Math.floor(maxActive)) : 1;
  const same = devices.find((d) => d.fingerprint_hash === fingerprintHash) ?? null;
  const incomingId = same?.id ?? null;
  const reason: RegisterDecision["reason"] = same
    ? (same.removed_at === null ? "already_active" : "reactivate")
    : "new";

  // a device that already holds a slot changes nothing by signing in again.
  if (reason === "already_active") return { reason, existing_id: incomingId, superseded: [] };

  // the device signing in takes a slot, so the others compete for `ceiling - 1`; the least recent lose.
  const others = byRecency(activeDevices(devices).filter((d) => d.id !== incomingId));
  const superseded = others.slice(ceiling - 1).reverse();
  return { reason, existing_id: incomingId, superseded };
}

export const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
export const PLATFORMS = ["ios", "android", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];
export function isPlatform(x: unknown): x is Platform {
  return typeof x === "string" && (PLATFORMS as readonly string[]).includes(x);
}
