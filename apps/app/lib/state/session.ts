/**
 * Device credentials + revocation notices, the pure part of useAuth (SPEC §5.3, 0022).
 *
 * `register-device` hands the install a device id and a session id. They must survive a reload —
 * a reload that re-registers is what produced two sessions per sign-in and signed the newest login
 * out — so they are written to BOTH localStorage (synchronous, first render) and the Dexie kv table
 * (survives a localStorage wipe); whichever store still has them re-seeds the other. The fingerprint
 * hash they were minted for rides along: when it ever differs from the current one, the client
 * asks register-device to *adopt* the stored device instead of minting a new one.
 *
 * Framework-free so the reload / adopt / revoked paths are unit-tested in Node.
 */
import type { KeyValue } from "./device.js";

export interface DeviceCreds {
  deviceId: string;
  sessionId: string;
  userId: string;
  /** fingerprint hash the device row was registered under; absent for creds minted before 0022 */
  fingerprintHash?: string | null;
}

/** localStorage key for the creds; the Dexie kv key stays `auth.device` (pre-0022 installs). */
export const DEVICE_CREDS_KEY = "rep-auth-device";
export const DEVICE_KV = "auth.device";
/** localStorage key for the "why you were signed out" notice shown on the sign-in screen. */
export const REVOKED_NOTICE_KEY = "rep-auth-revoked";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;

export interface KvStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }

export function parseCreds(x: unknown): DeviceCreds | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.deviceId !== "string" || !UUID_RE.test(r.deviceId)) return null;
  if (typeof r.sessionId !== "string" || !UUID_RE.test(r.sessionId)) return null;
  if (typeof r.userId !== "string" || !UUID_RE.test(r.userId)) return null;
  const fp = typeof r.fingerprintHash === "string" && HASH_RE.test(r.fingerprintHash) ? r.fingerprintHash : null;
  return { deviceId: r.deviceId, sessionId: r.sessionId, userId: r.userId, fingerprintHash: fp };
}

/** Read the creds: localStorage first, then kv; re-seed whichever store was missing them. */
export async function loadCreds(storage: KeyValue | null | undefined, kv: KvStore | null | undefined): Promise<DeviceCreds | null> {
  const fromStorage = parseCreds(safe(() => { const raw = storage?.getItem(DEVICE_CREDS_KEY); return raw ? JSON.parse(raw) : null; }));
  if (fromStorage) {
    if (kv) await kv.put(DEVICE_KV, fromStorage).catch(() => {});
    return fromStorage;
  }
  const fromKv = kv ? parseCreds(await kv.get(DEVICE_KV).catch(() => null)) : null;
  if (fromKv) safe(() => storage?.setItem(DEVICE_CREDS_KEY, JSON.stringify(fromKv)));
  return fromKv;
}

export async function saveCreds(storage: KeyValue | null | undefined, kv: KvStore | null | undefined, creds: DeviceCreds): Promise<void> {
  const plain: DeviceCreds = { deviceId: creds.deviceId, sessionId: creds.sessionId, userId: creds.userId, fingerprintHash: creds.fingerprintHash ?? null };
  safe(() => storage?.setItem(DEVICE_CREDS_KEY, JSON.stringify(plain)));
  if (kv) await kv.put(DEVICE_KV, plain).catch(() => {});
}

export async function clearCreds(storage: KeyValue | null | undefined, kv: KvStore | null | undefined): Promise<void> {
  safe(() => storage?.setItem(DEVICE_CREDS_KEY, ""));
  if (kv) await kv.delete(DEVICE_KV).catch(() => {});
}

export type EnsureDecision = "reuse" | "adopt" | "register";

/**
 * What a signed-in user with these stored creds should do on launch:
 *   reuse    — same user, same fingerprint (or a pre-0022 record with none): send the stored ids, no call
 *   adopt    — same user, fingerprint changed: one register-device call carrying the stored device id
 *   register — no creds, or creds for somebody else
 */
export function decideEnsureDevice(creds: DeviceCreds | null, uid: string, fingerprintHash: string | null): EnsureDecision {
  if (!creds || creds.userId !== uid) return "register";
  if (!creds.fingerprintHash || !fingerprintHash || creds.fingerprintHash === fingerprintHash) return "reuse";
  return "adopt";
}

// ---------------------------------------------------------------------------
// revocation notices
// ---------------------------------------------------------------------------

export interface RevokedInfo {
  reason: "new_device" | "device_removed" | "admin_disabled" | "expired" | "superseded" | "unknown";
  newDeviceName: string | null;
  newDevicePlatform: string | null;
  /** iso */
  at: string | null;
  maxDevices: number;
}

const REASONS = new Set(["new_device", "device_removed", "admin_disabled", "expired", "superseded", "unknown"]);

/** From the `{ reason, details }` extra on a 401 session_revoked (apps/api _shared/session-revoked.ts). */
export function revokedInfoFromExtra(extra: Record<string, unknown> | null | undefined, fallbackMax = 2): RevokedInfo {
  const reason = typeof extra?.reason === "string" && REASONS.has(extra.reason) ? extra.reason as RevokedInfo["reason"] : "unknown";
  const d = extra?.details && typeof extra.details === "object" ? extra.details as Record<string, unknown> : {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const max = typeof d.max_active_devices === "number" && d.max_active_devices >= 1 ? Math.floor(d.max_active_devices) : fallbackMax;
  return { reason, newDeviceName: str(d.new_device_name), newDevicePlatform: str(d.new_device_platform), at: str(d.at), maxDevices: max };
}

export function deviceLabel(platform: string | null | undefined): string {
  return platform === "web" ? "another computer" : platform === "ios" || platform === "android" ? "another phone" : "another device";
}

export function defaultFormatTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
}

/** The persistent sign-in screen notice for an evicted / removed device. */
export function revokedNoticeText(info: RevokedInfo, formatTime: (iso: string) => string = defaultFormatTime): string {
  const devices = info.maxDevices === 1 ? "one device" : `${info.maxDevices} devices`;
  switch (info.reason) {
    case "new_device": {
      const where = info.newDeviceName ?? deviceLabel(info.newDevicePlatform);
      const when = info.at ? ` at ${formatTime(info.at)}` : "";
      return `You were signed out because your account signed in on ${where}${when}. Up to ${devices} can be active; you can manage devices in Account.`;
    }
    case "device_removed":
      return "This device was signed out of your account from the Devices list. Sign in again to keep studying here.";
    case "admin_disabled":
      return "This account has been disabled. Contact support if you think this is a mistake.";
    case "expired":
      return "Your session expired. Sign in again to keep studying.";
    default:
      return "You were signed out because this session is no longer active. Sign in again to keep studying here.";
  }
}

export interface SignedOutDevice { id?: string; name?: string | null; platform?: string | null }

/** One-time toast for the device that just signed in and pushed somebody out; null when nobody was. */
export function evictionToastText(signedOut: SignedOutDevice[] | null | undefined, maxDevices: number): string | null {
  if (!signedOut || signedOut.length === 0) return null;
  const were = maxDevices === 1 ? "one device was" : `${maxDevices === 2 ? "two" : maxDevices} devices were`;
  if (signedOut.length === 1) {
    const d = signedOut[0]!;
    const who = d.name ?? (d.platform === "web" ? "Your other computer" : "Your other device");
    return `Signed in. ${who} was signed out because ${were} already active.`;
  }
  return `Signed in. ${signedOut.length} other devices were signed out because ${were} already active.`;
}

export interface StoredNotice { kind: "info" | "warn"; text: string; at: number }

export function saveRevokedNotice(storage: KeyValue | null | undefined, text: string, kind: StoredNotice["kind"] = "warn", now = Date.now()): void {
  safe(() => storage?.setItem(REVOKED_NOTICE_KEY, JSON.stringify({ kind, text, at: now } satisfies StoredNotice)));
}
export function loadRevokedNotice(storage: KeyValue | null | undefined): StoredNotice | null {
  const v = safe(() => { const raw = storage?.getItem(REVOKED_NOTICE_KEY); return raw ? JSON.parse(raw) as unknown : null; });
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.text !== "string" || !r.text) return null;
  return { kind: r.kind === "info" ? "info" : "warn", text: r.text, at: typeof r.at === "number" ? r.at : 0 };
}
export function clearRevokedNotice(storage: KeyValue | null | undefined): void {
  safe(() => storage?.setItem(REVOKED_NOTICE_KEY, ""));
}
