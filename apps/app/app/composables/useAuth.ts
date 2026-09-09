/**
 * Supabase auth + the SPEC §5.3 device/session binding, auth-first per V2 §1.
 *
 * - Sign-in is email + 6-digit code only (`signInWithEmail` → `verifyEmailCode`). OAuth is gone.
 * - `init()` restores the session and then runs the signed-in hooks (device hash, register-device,
 *   entitlement, study-state hydrate, free tier) BEFORE `ready` flips, so no screen ever renders
 *   free-tier or empty-progress UI for a paid, experienced learner (V2 §6.1). Slow networks are
 *   capped: after HYDRATE_TIMEOUT_MS the app proceeds and the hooks finish in the background.
 * - `register-device` binds the install (device hash) and takes over the account's single device
 *   slot; its ids are sent as x-device-id / x-session-id. `session_revoked` → local sign-out.
 *   One device at a time (0015): signing in here signs out wherever you were before, and it can
 *   never be refused, so there is no device-limit state to carry.
 */
import type { User } from "@supabase/supabase-js";
import { runSignedIn, runSignedOut, withTimeout } from "~~/lib/state/hooks";
import { getDb } from "~~/lib/study/db";
import { callFunction, functionsBase } from "~~/lib/study/api";
import { defaultDeviceName, platform } from "~~/lib/study/fingerprint";

/** Fallback wording when a displaced device was never given a name. */
function deviceLabel(p: string): string {
  return p === "web" ? "your computer" : p === "ios" || p === "android" ? "your phone" : "your other device";
}

export interface DeviceCreds { deviceId: string; sessionId: string; userId: string }
export interface AuthNotice { kind: "info" | "warn"; text: string }

export const SESSION_REVOKED_MESSAGE = "You signed in on another device. Sign in again to study here.";
export const HYDRATE_TIMEOUT_MS = 8000;
const DEVICE_KV = "auth.device";

let inited = false;
let signingOut = false;
let registering: Promise<boolean> | null = null;
let hydratedFor: string | null = null;
let hydrating: Promise<void> | null = null;

export function useAuth() {
  const supabase = useSupabase();
  const config = useRuntimeConfig();
  const dev = useDevice();
  const user = useState<User | null>("auth.user", () => null);
  const ready = useState<boolean>("auth.ready", () => false);
  const notice = useState<AuthNotice | null>("auth.notice", () => null);
  const device = useState<DeviceCreds | null>("auth.device", () => null);
  const busy = useState<boolean>("auth.busy", () => false);
  /** true while the signed-in hooks (entitlement, study state …) run for the current user */
  const hydratingState = useState<boolean>("auth.hydrating", () => false);
  // from runtime config (not the client instance) so SSR and client agree on what to render
  const configured = !!(config.public.supabaseUrl && config.public.supabaseAnonKey);
  const signedIn = computed(() => !!user.value);
  const base = configured ? functionsBase(config.public.supabaseUrl) : "";

  /** Idempotent; called once from app.vue (and by the auth middleware) on the client. */
  async function init(): Promise<void> {
    if (!import.meta.client) return;
    if (inited) { if (hydrating) await hydrating; return; }
    inited = true;
    if (!supabase) { ready.value = true; return; }
    try {
      const kv = await getDb().kv.get(DEVICE_KV);
      device.value = (kv?.value as DeviceCreds | undefined) ?? null;
      const { data } = await supabase.auth.getSession();
      user.value = data.session?.user ?? null;
      if (user.value) await withTimeout(hydrate(user.value, "init"), HYDRATE_TIMEOUT_MS);
    } catch (e) {
      if (import.meta.dev) console.warn("[auth] init", e);
    } finally {
      ready.value = true;
    }
    supabase.auth.onAuthStateChange((event, session) => {
      // never await supabase calls inside the callback (supabase-js deadlock note)
      setTimeout(() => {
        if (event === "SIGNED_OUT") {
          const hadUser = !!user.value;
          user.value = null;
          hydratedFor = null;
          if (!signingOut && hadUser) {
            notice.value = { kind: "warn", text: "Your sign-in expired. Sign in again to keep studying." };
            void runSignedOut("expired");
          }
          return;
        }
        if (event === "TOKEN_REFRESHED" && notice.value?.kind === "warn") notice.value = null;
        if (session?.user) {
          const changed = user.value?.id !== session.user.id;
          user.value = session.user;
          if (event === "SIGNED_IN" || changed) void hydrate(session.user, "sign_in");
        }
      }, 0);
    });
  }

  /** Register the device, then run the signed-in hooks once per uid (coalesced). */
  function hydrate(u: User, event: "init" | "sign_in"): Promise<void> {
    if (hydratedFor === u.id && !hydrating) return Promise.resolve();
    if (hydrating && hydratedFor === u.id) return hydrating;
    hydratedFor = u.id;
    hydratingState.value = true;
    hydrating = (async () => {
      try {
        await ensureDevice(u);
        const ran = await runSignedIn({ uid: u.id, event }, (e) => { if (import.meta.dev) console.warn("[auth] signed-in hook", e); });
        // hooks are registered by plugins/bootstrap.client.ts; if none were (tests, odd load order) let a later call retry
        if (!ran) hydratedFor = null;
      } finally {
        hydrating = null;
        hydratingState.value = false;
      }
    })();
    return hydrating;
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

  /** Bearer + apikey (+ device/session ids when this install is registered). x-device-hash is added by callFunction. */
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

  /**
   * register-device: binds this install and takes over the account's single device slot. Whatever
   * device held it is signed out (it sees 401 session_revoked), so this call cannot be refused.
   */
  function registerDevice(name?: string): Promise<boolean> {
    if (registering) return registering;
    registering = (async () => {
      const uid = user.value?.id;
      const token = await accessToken();
      if (!supabase || !uid || !token) return false;
      busy.value = true;
      try {
        const deviceHash = await dev.ensure();
        const res = await callFunction<{
          device_id: string;
          session_id: string;
          signed_out?: Array<{ id: string; platform: string; name: string | null }>;
        }>(base, "register-device", {
          fingerprint_hash: deviceHash,
          device_hash: deviceHash,
          platform: platform(),
          name: name ?? defaultDeviceName(),
        }, { authorization: `Bearer ${token}`, apikey: config.public.supabaseAnonKey });
        const creds: DeviceCreds = { deviceId: res.device_id, sessionId: res.session_id, userId: uid };
        device.value = creds;
        await getDb().kv.put({ key: DEVICE_KV, value: creds });
        // say so plainly rather than letting the other device go quiet unexplained
        const kicked = res.signed_out?.[0];
        if (kicked) {
          notice.value = { kind: "info", text: `Signed out ${kicked.name ?? deviceLabel(kicked.platform)} — one device at a time.` };
        }
        return true;
      } catch {
        // registration can no longer be refused on policy grounds, so anything here is transport
        notice.value = { kind: "warn", text: "Couldn't register this device yet. We'll retry when you're online." };
        return false;
      } finally {
        busy.value = false;
        registering = null;
      }
    })();
    return registering;
  }

  /** Step 1: send the 6-digit code. Same call creates the account on first use. */
  async function signInWithEmail(email: string): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Accounts are not configured in this build." };
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  /**
   * Step 2: verify the code. Resolves only after the signed-in hooks ran (entitlement, study state,
   * device), so the caller can navigate straight to Home without a flash of empty state.
   */
  async function verifyEmailCode(email: string, token: string): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Accounts are not configured in this build." };
    busy.value = true;
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: token.replace(/\s+/g, ""), type: "email" });
      if (error) return { ok: false, error: error.message };
      if (data.session?.user) {
        user.value = data.session.user;
        notice.value = null;
        await withTimeout(hydrate(data.session.user, "sign_in"), HYDRATE_TIMEOUT_MS);
      }
      return { ok: true };
    } finally {
      busy.value = false;
    }
  }

  /** Local sign-out only: the other device that just signed in keeps its own refresh token. */
  async function signOut(reason?: string): Promise<void> {
    signingOut = true;
    try {
      await runSignedOut(reason === SESSION_REVOKED_MESSAGE ? "revoked" : "user");
      if (supabase) await supabase.auth.signOut({ scope: "local" });
    } catch { /* offline is fine */ } finally { signingOut = false; }
    user.value = null;
    hydratedFor = null;
    device.value = null;
    await getDb().kv.delete(DEVICE_KV);
    notice.value = reason ? { kind: "info", text: reason } : null;
  }

  async function onSessionRevoked(): Promise<void> {
    await signOut(SESSION_REVOKED_MESSAGE);
  }

  function dismissNotice() { notice.value = null; }

  return {
    configured, ready, user, signedIn, notice, device, busy, hydrating: hydratingState,
    init, accessToken, authHeaders, apiHeaders, registerDevice,
    signInWithEmail, verifyEmailCode, signOut, onSessionRevoked, dismissNotice,
  };
}
