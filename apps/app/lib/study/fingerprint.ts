/**
 * Stable per-install identifier for the device registry (SPEC §5.3). `register-device` wants a
 * sha256 hex of something that survives app restarts but does not identify the person:
 *   native → @capacitor/device `getId()` (iOS identifierForVendor / Android ANDROID_ID)
 *   web    → a random UUID kept in localStorage
 * The raw id never leaves the device; only the hash is sent.
 */
import { Capacitor } from "@capacitor/core";

const WEB_KEY = "rep-install-id";

export type Platform = "ios" | "android" | "web";

export function platform(): Platform {
  const p = Capacitor.getPlatform();
  return p === "ios" || p === "android" ? p : "web";
}

export async function installId(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Device } = await import("@capacitor/device");
      const { identifier } = await Device.getId();
      if (identifier) return identifier;
    } catch { /* fall through to the web strategy inside the webview */ }
  }
  try {
    const existing = localStorage.getItem(WEB_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(WEB_KEY, fresh);
    return fresh;
  } catch {
    // no storage (private mode): a per-load id still lets the session work; it just counts as a new device
    return crypto.randomUUID();
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintHash(): Promise<string> {
  return sha256Hex(`rep:${platform()}:${await installId()}`);
}

/** A human-readable default device name for the account page. */
export function defaultDeviceName(): string {
  const p = platform();
  if (p !== "web") return p === "ios" ? "iPhone / iPad" : "Android";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" on ");
}
