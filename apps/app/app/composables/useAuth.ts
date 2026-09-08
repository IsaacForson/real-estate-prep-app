/**
 * Supabase auth + the SPEC §5.3 device/session binding.
 *
 * - Magic link + Apple/Google OAuth. Sessions are long-lived and refreshed by supabase-js; nothing
 *   here ever blocks the study path (F13). A refresh that fails for good only raises a banner.
 * - On the first sign-in on an install, `register-device` binds the install (stable fingerprint)
 *   and starts the account's single live session. Its ids are kept in Dexie kv and sent as
 *   x-device-id / x-session-id on every function call.
 * - `session_revoked` from any call → sign out here with the one-line explanation.
 */
import type { User } from "@supabase/supabase-js";
import { getDb } from "~~/lib/study/db";
import { ApiError, callFunction, functionsBase } from "~~/lib/study/api";
import { defaultDeviceName, fingerprintHash, platform } from "~~/lib/study/fingerprint";

export interface DeviceCreds { deviceId: string; sessionId: string; userId: string }
export interface DeviceLimit {
  max: number;
  occupied: number;
  nextSlotFreesAt: string | null;
  devices: Array<{ id: string; platform: string; name: string | null; last_seen: string }>;
}
export interface AuthNotice { kind: "info" | "warn"; text: string }

export const SESSION_REVOKED_MESSAGE = "You signed in on another device. One active session per account.";
const DEVICE_KV = "auth.device";

let inited = false;
let signingOut = false;
let registering: Promise<boolean> | null = null;

export function useAuth() {
  const supabase = useSupabase();
  const config = useRuntimeConfig();
  const user = useState<User | null>("auth.user", () => null);
  const ready = useState<boolean>("auth.ready", () => false);
  const notice = useState<AuthNotice | null>("auth.notice", () => null);
  const device = useState<DeviceCreds | null>("auth.device", () => null);
  const deviceLimit = useState<DeviceLimit | null>("auth.deviceLimit", () => null);
  const busy = useState<boolean>("auth.busy", () => false);
  // from runtime config (not the client instance) so SSR and client agree on what to render
  const configured = !!(config.public.supabaseUrl && config.public.supabaseAnonKey);
  const signedIn = computed(() => !!user.value);
  const base = configured ? functionsBase(config.public.supabaseUrl) : "";

  /** Idempotent; called once from app.vue on the client. */
  async function init(): Promise<void> {
    if (inited || !import.meta.client) return;
    inited = true;
    if (!supabase) { ready.value = true; return; }
    try {
      const kv = await getDb().kv.get(DEVICE_KV);
      device.value = (kv?.value as DeviceCreds | undefined) ?? null;
      const { data } = await supabase.auth.getSession();
      user.value = data.session?.user ?? null;
    } finally {
      ready.value = true;
    }
    if (user.value) void ensureDevice(user.value);
    supabase.auth.onAuthStateChange((event, session) => {
      // never await supabase calls inside the callback (supabase-js deadlock note)
      setTimeout(() => {
        if (event === "SIGNED_OUT") {
          user.value = null;
          if (!signingOut) {
            notice.value = {
              kind: "warn",
              text: "Your sign-in expired. Studying continues locally; sign in again to sync and load new questions.",
            };
          }
          return;
        }
        if (event === "TOKEN_REFRESHED" && notice.value?.kind === "warn") notice.value = null;
        if (session?.user) {
          const changed = user.value?.id !== session.user.id;
          user.value = session.user;
          if (event === "SIGNED_IN" || changed) void ensureDevice(session.user);
        }
      }, 0);
    });
  }

  async function ensureDevice(u: User): Promise<void> {
    if (device.value && device.value.userId === u.id) return;
    await registerDevice();
  }

  async function accessToken(): Promise<string | null> {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  /** Bearer + apikey (+ device/session ids when this install is registered). */
  async function authHeaders(): Promise<Record<string, string> | null> {
    const token = await accessToken();
    if (!token) return null;
    const h: Record<string, string> = { authorization: `Bearer ${token}`, apikey: config.public.supabaseAnonKey };
    const d = device.value;
    if (d && d.userId === user.value?.id) { h["x-device-id"] = d.deviceId; h["x-session-id"] = d.sessionId; }
    return h;
  }

  /** Headers for issue-batch / sync-progress: null until the device is registered. */
  async function apiHeaders(): Promise<Record<string, string> | null> {
    const h = await authHeaders();
    return h && h["x-device-id"] ? h : null;
  }

  /** register-device: binds this install and starts the single live session (kicks other devices). */
  function registerDevice(name?: string): Promise<boolean> {
    if (registering) return registering;
    registering = (async () => {
      const uid = user.value?.id;
      const token = await accessToken();
      if (!supabase || !uid || !token) return false;
      busy.value = true;
      try {
        const res = await callFunction<{ device_id: string; session_id: string }>(base, "register-device", {
          fingerprint_hash: await fingerprintHash(),
          platform: platform(),
          name: name ?? defaultDeviceName(),
        }, { authorization: `Bearer ${token}`, apikey: config.public.supabaseAnonKey });
        const creds: DeviceCreds = { deviceId: res.device_id, sessionId: res.session_id, userId: uid };
        device.value = creds;
        await getDb().kv.put({ key: DEVICE_KV, value: creds });
        deviceLimit.value = null;
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.code === "device_limit") {
          const x = e.extra as Partial<{ max: number; occupied: number; next_slot_frees_at: string | null; devices: DeviceLimit["devices"] }>;
          deviceLimit.value = { max: x.max ?? 3, occupied: x.occupied ?? 3, nextSlotFreesAt: x.next_slot_frees_at ?? null, devices: x.devices ?? [] };
          notice.value = { kind: "warn", text: "This account already has 3 devices. Remove one on the Account page to study here." };
        } else {
          notice.value = { kind: "warn", text: "Couldn't register this device yet. Studying continues locally; we'll retry when you're online." };
        }
        return false;
      } finally {
        busy.value = false;
        registering = null;
      }
    })();
    return registering;
  }

  async function signInWithEmail(email: string): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Accounts are not configured in this build." };
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/account` } });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  async function signInWithOAuth(provider: "apple" | "google"): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Accounts are not configured in this build." };
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${location.origin}/account` } });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  /** Local sign-out only: the other device that just signed in keeps its own refresh token. */
  async function signOut(reason?: string): Promise<void> {
    signingOut = true;
    try { if (supabase) await supabase.auth.signOut({ scope: "local" }); } catch { /* offline is fine */ } finally { signingOut = false; }
    user.value = null;
    device.value = null;
    deviceLimit.value = null;
    await getDb().kv.delete(DEVICE_KV);
    notice.value = reason ? { kind: "info", text: reason } : null;
  }

  async function onSessionRevoked(): Promise<void> {
    await signOut(SESSION_REVOKED_MESSAGE);
  }

  function dismissNotice() { notice.value = null; }

  return {
    configured, ready, user, signedIn, notice, device, deviceLimit, busy,
    init, accessToken, authHeaders, apiHeaders, registerDevice,
    signInWithEmail, signInWithOAuth, signOut, onSessionRevoked, dismissNotice,
  };
}
