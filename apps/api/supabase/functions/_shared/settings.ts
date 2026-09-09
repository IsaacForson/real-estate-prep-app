/**
 * Operator-editable product rules (migration 0016 `app_settings`).
 *
 * Constants in limits.ts are the ones the product is defined by; these are the ones an operator is
 * expected to change without a deploy. Keep the split honest — a setting that no support ticket
 * would ever justify changing belongs in limits.ts, where it can be reasoned about statically.
 *
 * Reads go through the SQL helpers so RLS and clamping live in one place, and are memoised per
 * isolate for a few seconds: register-device reads the device ceiling on every sign-in and an edge
 * isolate serves many of them, but an admin flipping the rule should not have to wait long to see it.
 */
import { type Db, rpc } from "./db.ts";
import { DEFAULT_MAX_ACTIVE_DEVICES } from "./limits.ts";

const TTL_MS = 5_000;
const cache = new Map<string, { at: number; value: unknown }>();

/** Clear the memo. Tests call this; nothing in production needs to. */
export function resetSettingsCache(): void {
  cache.clear();
}

async function memo<T>(key: string, load: () => Promise<T>, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  try {
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    // A settings read must never be the reason a sign-in fails; fall back to the shipped default.
    console.error(`[settings] ${key} read failed; using default`, e instanceof Error ? e.message : e);
    return fallback;
  }
}

/** Raw setting object, or `{}` when the key is unset. */
export function appSetting(db: Db, key: string): Promise<Record<string, unknown>> {
  return memo(
    `setting:${key}`,
    async () => (await rpc<Record<string, unknown> | null>(db, "fn_app_setting", { p_key: key })) ?? {},
    {},
  );
}

/** How many devices may hold a live session at once. Clamped in SQL; 1 means takeover. */
export function maxActiveDevices(db: Db): Promise<number> {
  return memo(
    "max_active_devices",
    async () => {
      const n = await rpc<number>(db, "fn_max_active_devices", {});
      return typeof n === "number" && Number.isFinite(n) ? n : DEFAULT_MAX_ACTIVE_DEVICES;
    },
    DEFAULT_MAX_ACTIVE_DEVICES,
  );
}
