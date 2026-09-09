/**
 * Device identity (V2 §1, §6.1): one stable hash per install, computed once and persisted
 * (localStorage + 1-year cookie on web; @capacitor/device id + model on native). Registered as the
 * `x-device-hash` header provider for every edge-function call (lib/study/api.ts).
 */
import { Capacitor } from "@capacitor/core";
import { cachedDeviceHash, documentCookieJar, resolveDevice, type DevicePlatform } from "~~/lib/state/device";
import { setDeviceHashProvider } from "~~/lib/study/api";

let pending: Promise<string> | null = null;

export function platformName(): DevicePlatform {
  const p = Capacitor.getPlatform();
  return p === "ios" || p === "android" ? p : "web";
}

export function useDevice() {
  const hash = useState<string | null>("device.hash", () => null);
  const model = useState<string | null>("device.model", () => null);
  const platform = platformName();

  if (import.meta.client) {
    if (!hash.value) hash.value = cachedDeviceHash(localStorage);
    setDeviceHashProvider(() => hash.value);
  }

  /** Compute or restore the hash; idempotent and safe to await from anywhere. */
  function ensure(): Promise<string> {
    if (hash.value && platform === "web") return Promise.resolve(hash.value);
    if (!pending) {
      pending = resolveDevice({
        platform,
        native: async () => {
          const { Device } = await import("@capacitor/device");
          const [{ identifier }, info] = await Promise.all([Device.getId(), Device.getInfo().catch(() => null)]);
          return identifier ? { id: identifier, model: info?.model ?? null } : null;
        },
        storage: typeof localStorage !== "undefined" ? localStorage : null,
        cookies: typeof document !== "undefined" ? documentCookieJar() : null,
      }).then((d) => { hash.value = d.hash; model.value = d.model; return d.hash; })
        .finally(() => { pending = null; });
    }
    return pending;
  }

  return { hash, platform, model, ensure };
}
