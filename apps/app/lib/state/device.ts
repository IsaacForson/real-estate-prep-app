/**
 * Device hash (V2 §1 "Device tracking"). One stable, non-identifying hash per install:
 *   android → @capacitor/device getId() (app-scoped ANDROID_ID) + model
 *   ios     → identifierForVendor + model
 *   web     → random install id kept in BOTH localStorage and a 1-year cookie; whichever survives
 *             restores the other, so "clear site data" for one store alone does not mint a device.
 * Only the sha256 hex leaves the device, as header `x-device-hash` on every edge-function call
 * (lib/study/api.ts) and as `device_hash` on rows the server keys per device.
 * Pure: storage/cookie/native access is injected so it runs (and is tested) in Node.
 */
import { sha256Hex } from "../study/fingerprint.js";

export type DevicePlatform = "ios" | "android" | "web";

export const DEVICE_STORAGE_KEY = "rep-install-id";
export const DEVICE_COOKIE_NAME = "rep_install";
export const DEVICE_HASH_KEY = "rep-device-hash";
export const COOKIE_MAX_AGE_S = 365 * 86_400;
/** install ids are uuids (web) or whatever the OS gives us; bound the length so a cookie can carry it */
const ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export interface KeyValue { getItem(k: string): string | null; setItem(k: string, v: string): void }
export interface CookieJar { get(name: string): string | null; set(name: string, value: string, maxAgeS: number): void }

export interface DeviceEnv {
  platform: DevicePlatform;
  /** native only: app-scoped id and model; null when the plugin is unavailable */
  native?: () => Promise<{ id: string; model: string | null } | null>;
  storage?: KeyValue | null;
  cookies?: CookieJar | null;
  randomId?: () => string;
}

/** `document.cookie` adapter (browser). */
export function documentCookieJar(doc: { cookie: string } = document, secure = typeof location !== "undefined" && location.protocol === "https:"): CookieJar {
  return {
    get(name) {
      const m = doc.cookie.split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name);
      return m?.[1] ? decodeURIComponent(m[1]) : null;
    },
    set(name, value, maxAgeS) {
      doc.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeS}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
    },
  };
}

function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }

/** Web install id: restore from either store, write back to both. */
export function webInstallId(env: Pick<DeviceEnv, "storage" | "cookies" | "randomId">): { id: string; restoredFrom: "storage" | "cookie" | "fresh" } {
  const fromStorage = safe(() => env.storage?.getItem(DEVICE_STORAGE_KEY) ?? null);
  const fromCookie = safe(() => env.cookies?.get(DEVICE_COOKIE_NAME) ?? null);
  let id: string; let restoredFrom: "storage" | "cookie" | "fresh";
  if (fromStorage && ID_RE.test(fromStorage)) { id = fromStorage; restoredFrom = "storage"; }
  else if (fromCookie && ID_RE.test(fromCookie)) { id = fromCookie; restoredFrom = "cookie"; }
  else { id = (env.randomId ?? (() => crypto.randomUUID()))(); restoredFrom = "fresh"; }
  if (fromStorage !== id) safe(() => env.storage?.setItem(DEVICE_STORAGE_KEY, id));
  if (fromCookie !== id) safe(() => env.cookies?.set(DEVICE_COOKIE_NAME, id, COOKIE_MAX_AGE_S));
  return { id, restoredFrom };
}

/** sha256 of `rep:<platform>:<install id>[:<model>]`. */
export async function deviceHashFor(platform: DevicePlatform, id: string, model: string | null = null): Promise<string> {
  return sha256Hex(`rep:${platform}:${id}${model ? `:${model}` : ""}`);
}

export interface DeviceIdentity { hash: string; platform: DevicePlatform; model: string | null; restoredFrom: "storage" | "cookie" | "fresh" | "native" }

/**
 * Compute (or restore) the device identity. On native the plugin id is used when available and
 * the web strategy inside the webview is the fallback. The resulting hash is also cached in
 * storage so `useDevice().hash` is available synchronously on the next launch.
 */
export async function resolveDevice(env: DeviceEnv): Promise<DeviceIdentity> {
  if (env.platform !== "web" && env.native) {
    const n = await env.native().catch(() => null);
    if (n?.id) {
      const hash = await deviceHashFor(env.platform, n.id, n.model);
      safe(() => env.storage?.setItem(DEVICE_HASH_KEY, hash));
      return { hash, platform: env.platform, model: n.model, restoredFrom: "native" };
    }
  }
  const { id, restoredFrom } = webInstallId(env);
  const hash = await deviceHashFor(env.platform, id);
  safe(() => env.storage?.setItem(DEVICE_HASH_KEY, hash));
  return { hash, platform: env.platform, model: null, restoredFrom };
}

/** Last computed hash, if this install has one (synchronous, for the first render). */
export function cachedDeviceHash(storage: KeyValue | null | undefined): string | null {
  const v = safe(() => storage?.getItem(DEVICE_HASH_KEY) ?? null);
  return v && /^[0-9a-f]{64}$/.test(v) ? v : null;
}
