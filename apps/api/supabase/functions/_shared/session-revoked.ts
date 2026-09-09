/**
 * Why a session stopped being valid, in words the client can show (0022).
 *
 * `requireSession` answers 401 session_revoked; this decides the `reason` and `details` that ride
 * along so the evicted device can say "your account signed in on <device> at <time>" instead of a
 * generic "signed in elsewhere". Pure part (`describeRevocation`) is unit-tested; the db part just
 * fetches the two rows it needs.
 */
import type { Db } from "./db.ts";

export type RevokeReason = "new_device" | "device_removed" | "admin_disabled" | "expired" | "superseded" | "unknown";

export interface SessionRow {
  revoked_at: string | null;
  revoke_reason: string | null;
  revoked_by_device_id: string | null;
  is_shadow?: boolean | null;
  expires_at?: string | null;
  /** removed_at of the session's own device */
  device_removed_at?: string | null;
}

export interface EvictorRow {
  name: string | null;
  platform: string | null;
}

export interface RevocationDetails {
  new_device_name: string | null;
  new_device_platform: string | null;
  /** when the eviction happened (iso) */
  at: string | null;
  max_active_devices: number;
}

export interface Revocation {
  reason: RevokeReason;
  details: RevocationDetails;
  message: string;
}

/** Wording the client can also rebuild locally with a nicer time format. */
export function revocationMessage(reason: RevokeReason, d: RevocationDetails): string {
  const plural = d.max_active_devices === 1 ? "one device" : `${d.max_active_devices} devices`;
  switch (reason) {
    case "new_device": {
      const where = d.new_device_name ?? (d.new_device_platform === "web" ? "another computer" : "another device");
      const when = d.at ? ` at ${d.at}` : "";
      return `You were signed out because your account signed in on ${where}${when}. Up to ${plural} can be active; you can manage devices in Account.`;
    }
    case "device_removed":
      return "This device was signed out of your account from the Devices list. Sign in again to continue here.";
    case "admin_disabled":
      return "This account has been disabled. Contact support if you think this is a mistake.";
    case "expired":
      return "This session has expired. Sign in again to continue.";
    default:
      return "This session is no longer active. Sign in again to continue here.";
  }
}

export function describeRevocation(
  session: SessionRow | null,
  evictor: EvictorRow | null,
  maxActiveDevices: number,
  now: Date = new Date(),
): Revocation {
  const base: RevocationDetails = {
    new_device_name: null,
    new_device_platform: null,
    at: null,
    max_active_devices: maxActiveDevices,
  };
  if (!session) return { reason: "unknown", details: base, message: revocationMessage("unknown", base) };

  let reason: RevokeReason = "unknown";
  const r = session.revoke_reason;
  if (r === "new_device" || (r === "superseded" && session.revoked_by_device_id)) reason = "new_device";
  else if (r === "device_removed" || (session.revoked_at === null && session.device_removed_at)) {
    reason = "device_removed";
  } else if (r === "admin_disabled") reason = "admin_disabled";
  else if (r === "superseded") reason = "superseded";
  else if (session.is_shadow && session.expires_at && Date.parse(session.expires_at) <= now.getTime()) {
    reason = "expired";
  }

  const details: RevocationDetails = reason === "new_device"
    ? {
      ...base,
      new_device_name: evictor?.name ?? null,
      new_device_platform: evictor?.platform ?? null,
      at: session.revoked_at,
    }
    : { ...base, at: session.revoked_at ?? session.device_removed_at ?? null };
  return { reason, details, message: revocationMessage(reason, details) };
}

/** Fetch the session, its device's removed_at and the evicting device, then describe. Never throws. */
export async function loadRevocation(
  db: Db,
  userId: string,
  sessionId: string,
  maxActiveDevices: number,
): Promise<Revocation> {
  try {
    const { data } = await db
      .from("sessions")
      .select("device_id, revoked_at, revoke_reason, revoked_by_device_id, is_shadow, expires_at")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    const row = data as (Omit<SessionRow, "device_removed_at"> & { device_id: string }) | null;
    if (!row) return describeRevocation(null, null, maxActiveDevices);

    const ids = [row.device_id, row.revoked_by_device_id].filter((x): x is string => !!x);
    const { data: devs } = await db.from("devices").select("id, name, platform, removed_at").in("id", ids);
    const list = (devs ?? []) as Array<
      { id: string; name: string | null; platform: string | null; removed_at: string | null }
    >;
    const own = list.find((d) => d.id === row.device_id) ?? null;
    const evictor = row.revoked_by_device_id ? list.find((d) => d.id === row.revoked_by_device_id) ?? null : null;
    const session: SessionRow = { ...row, device_removed_at: own?.removed_at ?? null };
    return describeRevocation(
      session,
      evictor ? { name: evictor.name, platform: evictor.platform } : null,
      maxActiveDevices,
    );
  } catch (e) {
    console.warn("loadRevocation failed", e instanceof Error ? e.message : e);
    return describeRevocation(null, null, maxActiveDevices);
  }
}
