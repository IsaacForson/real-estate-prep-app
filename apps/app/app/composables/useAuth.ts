/**
 * Supabase auth + the SPEC §5.3 device/session binding, auth-first per V2 §1.
 *
 * - Sign-in is email + 6-digit code only (`signInWithEmail` → `verifyEmailCode`). OAuth is gone.
 * - `init()` restores the session and then runs the signed-in hooks (device hash, register-device,
 *   entitlement, study-state hydrate, free tier) BEFORE `ready` flips, so no screen ever renders
 *   free-tier or empty-progress UI for a paid, experienced learner (V2 §6.1). Slow networks are
 *   capped: after HYDRATE_TIMEOUT_MS the app proceeds and the hooks finish in the background.
 * - `register-device` binds the install and starts (or resumes) its session; its ids are sent as
 *   x-device-id / x-session-id. They persist in localStorage AND the Dexie kv table together with the
 *   fingerprint hash they were minted for (lib/state/session.ts), so a reload sends the stored ids
 *   and never registers again. If the fingerprint ever changes, one call *adopts* the stored device.
 * - Up to `max_active_devices` (default 2, 0022) may be active. A third sign-in evicts the oldest;
 *   that device gets 401 session_revoked with `reason: new_device` and signs out locally with a
 *   persistent notice on the sign-in screen naming the device that displaced it. Registration can
 *   never be refused, so there is no device-limit state to carry.
 */
import type { User } from "@supabase/supabase-js";
import { pushToast } from "~/components/Toast.vue";
import { runSignedIn, runSignedOut, withTimeout } from "~~/lib/state/hooks";
import {
  clearCreds, clearRevokedNotice, decideEnsureDevice, type DeviceCreds, evictionToastText, loadCreds, loadRevokedNotice,
  revokedInfoFromExtra, revokedNoticeText, saveCreds, saveRevokedNotice,
} from "~~/lib/state/session";
import { getDb } from "~~/lib/study/db";
import { ApiError, callFunction, functionsBase, takeLastRevocation } from "~~/lib/study/api";
import { defaultDeviceName, platform } from "~~/lib/study/fingerprint";

export type { DeviceCreds } from "~~/lib/state/session";
export interface AuthNotice { kind: "info" | "warn"; text: string }

export const HYDRATE_TIMEOUT_MS = 8000;
/** Default device ceiling for wording when the server did not say (mirrors app_settings.device_policy). */
export const DEFAULT_MAX_DEVICES = 2;

let inited = false;
let signingOut = false;
let registering: Promise<boolean> | null = null;
let hydratedFor: string | null = null;
let hydrating: Promise<void> | null = null;

function storage(): Storage | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}
/** Dexie kv table behind the small interface lib/state/session.ts expects. */
function kvStore() {
  const db = getDb();
  return {
    get: async (key: string) => (await db.kv.get(key))?.value,
    put: async (key: string, value: unknown) => { await db.kv.put({ key, value }); },
    delete: async (key: string) => { await db.kv.delete(key); },
  };
}

export function useAuth() {
  const supabase = useSupabase();
  const config = useRuntimeConfig();
  const dev = useDevice();
  const user = useState<User | null>("auth.user", () => null);
  const ready = useState<boolean>("auth.ready", () => false);
  const notice = useState<AuthNotice | null>("auth.notice", () => null);
  const device = useState<DeviceCreds | null>("auth.device", () => null);
  const busy = useState<boolean>("auth.busy", () => false);
  /** the device ceiling as last reported by register-device / session_revoked details */
  const maxDevices = useState<number>("auth.maxDevices", () => DEFAULT_MAX_DEVICES);
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
      device.value = await loadCreds(storage(), kvStore());
      const { data } = await supabase.auth.getSession();
      user.value = data.session?.user ?? null;
      if (user.value) await withTimeout(hydrate(user.value, "init"), HYDRATE_TIMEOUT_MS);
      else {
        // a device that was evicted while this tab was closed: say why on the sign-in screen
        const stored = loadRevokedNotice(storage());
        if (stored) notice.value = { kind: stored.kind, text: stored.text };
      }
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
            // another tab signed this browser out after a revocation: show its reason, not "expired"
            const stored = loadRevokedNotice(storage());
            notice.value = stored
              ? { kind: stored.kind, text: stored.text }
              : { kind: "warn", text: "Your sign-in expired. Sign in again to keep studying." };
            void runSignedOut(stored ? "revoked" : "expired");
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

  /**
   * Stored creds for this user → reuse them, no call. Stored creds whose fingerprint no longer matches
   * this install → one register-device call that adopts the stored device row. Otherwise register.
   */
  async function ensureDevice(u: User): Promise<void> {
    const hash = await dev.ensure().catch(() => null);
    const decision = decideEnsureDevice(device.value, u.id, hash);
    if (decision === "reuse") return;
    await registerDevice(undefined, decision === "adopt" ? device.value?.deviceId ?? null : null);
  }

  /**
   * Take device/session ids that were minted elsewhere instead of calling register-device.
   *
   * Only admin impersonation uses this: admin-api attaches a shadow session to a device the user
   * already has and hands the ids over here. Writing them before the auth state change lands is what
   * makes `ensureDevice` short-circuit.
   */
  async function adoptDevice(creds: DeviceCreds): Promise<void> {
    device.value = creds;
    await saveCreds(storage(), kvStore(), creds);
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

  interface RegisterResponse {
    device_id: string;
    session_id: string;
    created?: boolean;
    session_reused?: boolean;
    adopted?: boolean;
    max_active_devices?: number;
    signed_out?: Array<{ id: string; platform: string | null; name: string | null }>;
  }

  /**
   * register-device: binds this install and starts (or resumes) its session. Whatever this pushes over
   * the ceiling is signed out (it sees 401 session_revoked with our name), so this call cannot be
   * refused. `adoptDeviceId` carries the stored device id when only the fingerprint changed.
   */
  function registerDevice(name?: string, adoptDeviceId: string | null = null): Promise<boolean> {
    if (registering) return registering;
    registering = (async () => {
      const uid = user.value?.id;
      const token = await accessToken();
      if (!supabase || !uid || !token) return false;
      busy.value = true;
      try {
        const deviceHash = await dev.ensure();
        const body: Record<string, unknown> = {
          fingerprint_hash: deviceHash,
          device_hash: deviceHash,
          platform: platform(),
          name: name ?? defaultDeviceName(),
        };
        if (adoptDeviceId) body.device_id = adoptDeviceId;
        const res = await callFunction<RegisterResponse>(base, "register-device", body, {
          authorization: `Bearer ${token}`,
          apikey: config.public.supabaseAnonKey,
        });
        const creds: DeviceCreds = { deviceId: res.device_id, sessionId: res.session_id, userId: uid, fingerprintHash: deviceHash };
        device.value = creds;
        await saveCreds(storage(), kvStore(), creds);
        if (typeof res.max_active_devices === "number") maxDevices.value = res.max_active_devices;
        // we are signed in now; whatever put us on the sign-in screen is history
        clearRevokedNotice(storage());
        if (notice.value?.kind === "warn") notice.value = null;
        // say so plainly rather than letting the other device go quiet unexplained
        const toast = evictionToastText(res.signed_out, res.max_active_devices ?? maxDevices.value);
        if (toast) pushToast(toast, "info", 6000);
        return true;
      } catch (e) {
        if (import.meta.dev) console.warn("[auth] register-device", e);
        // registration is never refused on policy grounds, so anything here is transport / auth
        if (!(e instanceof ApiError && e.status === 401)) {
          notice.value = { kind: "warn", text: "Couldn't register this device yet. We'll retry when you're online." };
        }
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
        clearRevokedNotice(storage());
        await withTimeout(hydrate(data.session.user, "sign_in"), HYDRATE_TIMEOUT_MS);
      }
      return { ok: true };
    } finally {
      busy.value = false;
    }
  }

  /**
   * Local sign-out only: other devices keep their own sessions. `reason` is shown as a notice; pass
   * `kind: "revoked"` when the server pushed us out so the notice survives into the sign-in screen.
   */
  async function signOut(reason?: string, kind: "user" | "revoked" = "user"): Promise<void> {
    signingOut = true;
    try {
      await runSignedOut(kind);
      if (supabase) await supabase.auth.signOut({ scope: "local" });
    } catch { /* offline is fine */ } finally { signingOut = false; }
    user.value = null;
    hydratedFor = null;
    device.value = null;
    await clearCreds(storage(), kvStore());
    if (reason) {
      notice.value = { kind: kind === "revoked" ? "warn" : "info", text: reason };
      if (kind === "revoked") saveRevokedNotice(storage(), reason, "warn");
    } else {
      notice.value = null;
    }
  }

  /**
   * A call answered 401 session_revoked. Explain why (the error's `reason`/`details`, or the last one
   * any call saw) and sign out locally; the notice persists until the next successful sign-in.
   */
  async function onSessionRevoked(e?: unknown): Promise<void> {
    const extra = e instanceof ApiError ? e.extra : takeLastRevocation();
    const info = revokedInfoFromExtra(extra, maxDevices.value);
    if (info.maxDevices) maxDevices.value = info.maxDevices;
    await signOut(revokedNoticeText(info), "revoked");
  }

  function dismissNotice() {
    notice.value = null;
    clearRevokedNotice(storage());
  }

  return {
    configured, ready, user, signedIn, notice, device, busy, maxDevices, hydrating: hydratingState,
    init, accessToken, authHeaders, apiHeaders, registerDevice, adoptDevice,
    signInWithEmail, verifyEmailCode, signOut, onSessionRevoked, dismissNotice,
  };
}
