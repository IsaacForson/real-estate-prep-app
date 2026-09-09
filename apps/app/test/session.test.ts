import { describe, expect, it } from "vitest";
import {
  clearCreds, clearRevokedNotice, decideEnsureDevice, DEVICE_CREDS_KEY, DEVICE_KV, type DeviceCreds, evictionToastText,
  type KvStore, loadCreds, loadRevokedNotice, parseCreds, REVOKED_NOTICE_KEY, revokedInfoFromExtra, revokedNoticeText,
  saveCreds, saveRevokedNotice,
} from "../lib/state/session.js";
import type { KeyValue } from "../lib/state/device.js";

function memStorage(init: Record<string, string> = {}): KeyValue & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}
function memKv(init: Record<string, unknown> = {}): KvStore & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(init));
  return { data, get: async (k) => data.get(k), put: async (k, v) => { data.set(k, v); }, delete: async (k) => { data.delete(k); } };
}
const UID = "0f6c3f2e-6f4d-4d7e-9a2b-1c3d5e7f9a1b";
const DEV = "1a6c3f2e-6f4d-4d7e-9a2b-1c3d5e7f9a1c";
const SES = "2b6c3f2e-6f4d-4d7e-9a2b-1c3d5e7f9a1d";
const HASH = "a".repeat(64);
const creds: DeviceCreds = { deviceId: DEV, sessionId: SES, userId: UID, fingerprintHash: HASH };

describe("stored device credentials survive a reload", () => {
  it("round-trips through localStorage and kv, and either store re-seeds the other", async () => {
    const storage = memStorage(), kv = memKv();
    await saveCreds(storage, kv, creds);
    expect(JSON.parse(storage.data.get(DEVICE_CREDS_KEY)!)).toEqual(creds);
    expect(kv.data.get(DEVICE_KV)).toEqual(creds);

    // localStorage wiped: kv restores and re-seeds localStorage
    const s2 = memStorage();
    expect(await loadCreds(s2, kv)).toEqual(creds);
    expect(JSON.parse(s2.data.get(DEVICE_CREDS_KEY)!)).toEqual(creds);

    // kv wiped: localStorage restores and re-seeds kv
    const kv2 = memKv();
    expect(await loadCreds(storage, kv2)).toEqual(creds);
    expect(kv2.data.get(DEVICE_KV)).toEqual(creds);

    await clearCreds(storage, kv);
    expect(await loadCreds(storage, kv)).toBeNull();
  });

  it("accepts pre-0022 kv records without a fingerprint and rejects garbage", async () => {
    const legacy = { deviceId: DEV, sessionId: SES, userId: UID };
    expect(await loadCreds(memStorage(), memKv({ [DEVICE_KV]: legacy }))).toEqual({ ...legacy, fingerprintHash: null });
    expect(parseCreds({ deviceId: "nope", sessionId: SES, userId: UID })).toBeNull();
    expect(parseCreds(null)).toBeNull();
    const throwing: KeyValue = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("Quota"); } };
    expect(await loadCreds(throwing, memKv({ [DEVICE_KV]: creds }))).toEqual(creds);
  });

  it("reuses stored creds on reload instead of registering again", () => {
    // the bug: every reload re-registered, minting a second session and revoking the first
    expect(decideEnsureDevice(creds, UID, HASH)).toBe("reuse");
    // a record from before the fingerprint was stored is trusted as-is
    expect(decideEnsureDevice({ ...creds, fingerprintHash: null }, UID, HASH)).toBe("reuse");
    // the hash could not be computed (no storage): keep what we have
    expect(decideEnsureDevice(creds, UID, null)).toBe("reuse");
  });

  it("adopts the stored device when only the fingerprint changed, registers for a new user", () => {
    expect(decideEnsureDevice(creds, UID, "b".repeat(64))).toBe("adopt");
    expect(decideEnsureDevice(creds, "9f6c3f2e-6f4d-4d7e-9a2b-1c3d5e7f9a1b", HASH)).toBe("register");
    expect(decideEnsureDevice(null, UID, HASH)).toBe("register");
  });
});

describe("revocation notices", () => {
  const extra = {
    reason: "new_device",
    details: { new_device_name: "Chrome on Mac", new_device_platform: "web", at: "2026-09-09T10:00:00Z", max_active_devices: 2 },
  };

  it("names the device that evicted us, the time, and where to manage devices", () => {
    const info = revokedInfoFromExtra(extra);
    expect(info).toEqual({ reason: "new_device", newDeviceName: "Chrome on Mac", newDevicePlatform: "web", at: "2026-09-09T10:00:00Z", maxDevices: 2 });
    expect(revokedNoticeText(info, () => "10:00")).toBe(
      "You were signed out because your account signed in on Chrome on Mac at 10:00. Up to 2 devices can be active; you can manage devices in Account.",
    );
    // unnamed device falls back to its platform
    const anon = revokedInfoFromExtra({ reason: "new_device", details: { new_device_platform: "android" } });
    expect(revokedNoticeText(anon, () => "x")).toContain("signed in on another phone.");
  });

  it("degrades to a generic message when the server said nothing useful", () => {
    const info = revokedInfoFromExtra(null);
    expect(info.reason).toBe("unknown");
    expect(info.maxDevices).toBe(2);
    expect(revokedNoticeText(info)).toMatch(/no longer active/);
    expect(revokedNoticeText(revokedInfoFromExtra({ reason: "device_removed" }))).toMatch(/Devices list/);
  });

  it("persists across the redirect to the sign-in screen until dismissed", () => {
    const storage = memStorage();
    saveRevokedNotice(storage, "why", "warn", 123);
    expect(loadRevokedNotice(storage)).toEqual({ kind: "warn", text: "why", at: 123 });
    clearRevokedNotice(storage);
    expect(loadRevokedNotice(storage)).toBeNull();
    expect(loadRevokedNotice(memStorage({ [REVOKED_NOTICE_KEY]: "{not json" }))).toBeNull();
  });

  it("tells the new device what it displaced, once", () => {
    expect(evictionToastText([], 2)).toBeNull();
    expect(evictionToastText(null, 2)).toBeNull();
    expect(evictionToastText([{ name: "Pixel 8", platform: "android" }], 2)).toBe(
      "Signed in. Pixel 8 was signed out because two devices were already active.",
    );
    expect(evictionToastText([{ name: null, platform: "web" }], 1)).toBe(
      "Signed in. Your other computer was signed out because one device was already active.",
    );
    expect(evictionToastText([{ name: "a" }, { name: "b" }], 3)).toBe(
      "Signed in. 2 other devices were signed out because 3 devices were already active.",
    );
  });
});
