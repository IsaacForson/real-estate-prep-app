import { describe, it, expect } from "vitest";
import {
  COOKIE_MAX_AGE_S, DEVICE_COOKIE_NAME, DEVICE_HASH_KEY, DEVICE_STORAGE_KEY,
  cachedDeviceHash, deviceHashFor, documentCookieJar, resolveDevice, webInstallId, type CookieJar, type KeyValue,
} from "../lib/state/device.js";
import { callFunction, DEVICE_HASH_HEADER, setDeviceHashProvider, withDeviceHash } from "../lib/study/api.js";

function memStorage(init: Record<string, string> = {}): KeyValue & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}
function memCookies(init: Record<string, string> = {}): CookieJar & { data: Map<string, string>; maxAge: number | null } {
  const jar = { data: new Map(Object.entries(init)), maxAge: null as number | null, get: (n: string) => jar.data.get(n) ?? null, set: (n: string, v: string, m: number) => { jar.data.set(n, v); jar.maxAge = m; } };
  return jar;
}
const UUID = "0f6c3f2e-6f4d-4d7e-9a2b-1c3d5e7f9a1b";

describe("device hash: web install id survives in two places", () => {
  it("mints once and writes to both localStorage and a 1-year cookie", () => {
    const storage = memStorage(), cookies = memCookies();
    const r = webInstallId({ storage, cookies, randomId: () => UUID });
    expect(r).toEqual({ id: UUID, restoredFrom: "fresh" });
    expect(storage.data.get(DEVICE_STORAGE_KEY)).toBe(UUID);
    expect(cookies.data.get(DEVICE_COOKIE_NAME)).toBe(UUID);
    expect(cookies.maxAge).toBe(COOKIE_MAX_AGE_S);
    expect(COOKIE_MAX_AGE_S).toBe(365 * 86_400);
  });
  it("restores from the cookie when localStorage was cleared, and vice versa", () => {
    const s1 = memStorage(), c1 = memCookies({ [DEVICE_COOKIE_NAME]: UUID });
    expect(webInstallId({ storage: s1, cookies: c1, randomId: () => "never" })).toEqual({ id: UUID, restoredFrom: "cookie" });
    expect(s1.data.get(DEVICE_STORAGE_KEY)).toBe(UUID); // re-seeded
    const s2 = memStorage({ [DEVICE_STORAGE_KEY]: UUID }), c2 = memCookies();
    expect(webInstallId({ storage: s2, cookies: c2, randomId: () => "never" })).toEqual({ id: UUID, restoredFrom: "storage" });
    expect(c2.data.get(DEVICE_COOKIE_NAME)).toBe(UUID);
  });
  it("ignores garbage and storage that throws", () => {
    const bad: KeyValue = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); } };
    const r = webInstallId({ storage: bad, cookies: memCookies({ [DEVICE_COOKIE_NAME]: "x" }), randomId: () => UUID });
    expect(r.restoredFrom).toBe("fresh");
  });
  it("parses and writes document.cookie", () => {
    const doc = { cookie: "" };
    const jar = documentCookieJar(doc, false);
    jar.set(DEVICE_COOKIE_NAME, UUID, 10);
    expect(doc.cookie).toContain(`${DEVICE_COOKIE_NAME}=${UUID}`);
    expect(doc.cookie).toContain("Max-Age=10");
    expect(documentCookieJar({ cookie: `a=1; ${DEVICE_COOKIE_NAME}=${UUID}; b=2` }).get(DEVICE_COOKIE_NAME)).toBe(UUID);
  });
});

describe("device hash: stable, non-identifying, cached", () => {
  it("is the same sha256 for the same install and platform, different across platforms/models", async () => {
    const a = await deviceHashFor("web", UUID);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await deviceHashFor("web", UUID)).toBe(a);
    expect(await deviceHashFor("android", UUID)).not.toBe(a);
    expect(await deviceHashFor("android", UUID, "Pixel 8")).not.toBe(await deviceHashFor("android", UUID));
  });
  it("resolveDevice prefers the native id and caches the hash for the next launch", async () => {
    const storage = memStorage();
    const d = await resolveDevice({ platform: "android", native: async () => ({ id: "android-id-1234", model: "Pixel 8" }), storage, cookies: memCookies() });
    expect(d.restoredFrom).toBe("native");
    expect(d.model).toBe("Pixel 8");
    expect(d.hash).toBe(await deviceHashFor("android", "android-id-1234", "Pixel 8"));
    expect(cachedDeviceHash(storage)).toBe(d.hash);
    expect(storage.data.get(DEVICE_HASH_KEY)).toBe(d.hash);
    // plugin unavailable inside the webview → web strategy, still cached
    const s2 = memStorage();
    const w = await resolveDevice({ platform: "ios", native: async () => null, storage: s2, cookies: memCookies(), randomId: () => UUID });
    expect(w.restoredFrom).toBe("fresh");
    expect(w.hash).toBe(await deviceHashFor("ios", UUID));
    expect(cachedDeviceHash(memStorage({ [DEVICE_HASH_KEY]: "not-a-hash" }))).toBeNull();
  });
});

describe("x-device-hash on every function call", () => {
  it("is added by callFunction when a provider is registered and never overrides an explicit header", async () => {
    setDeviceHashProvider(() => "abc123");
    expect(withDeviceHash({ apikey: "k" })).toEqual({ apikey: "k", [DEVICE_HASH_HEADER]: "abc123" });
    expect(withDeviceHash({ [DEVICE_HASH_HEADER]: "explicit" })).toEqual({ [DEVICE_HASH_HEADER]: "explicit" });
    let seen: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => { seen = init.headers as Record<string, string>; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    await callFunction("https://x/functions/v1", "track-event", { events: [] }, { authorization: "Bearer t" }, fetchImpl);
    expect(seen[DEVICE_HASH_HEADER]).toBe("abc123");
    expect(seen.authorization).toBe("Bearer t");
    setDeviceHashProvider(() => null);
    expect(withDeviceHash({ apikey: "k" })).toEqual({ apikey: "k" });
    setDeviceHashProvider(null);
  });
});
