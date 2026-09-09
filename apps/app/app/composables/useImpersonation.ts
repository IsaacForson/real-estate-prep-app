/**
 * "Open the app as this user" for admins.
 *
 * The problem worth explaining: this app allows one device per account, so the naive way to
 * impersonate — sign in as the user, register your browser as their device — signs the real person
 * out of their own phone mid-study. Instead `users.impersonate` mints a session bound to a device
 * the user *already has* (fn_start_shadow_session) and hands the ids over, and we adopt them
 * directly. The learner never notices.
 *
 * The admin's own tokens are parked in sessionStorage so stopping is instant and survives a page
 * reload. sessionStorage (not localStorage) on purpose: closing the tab ends the impersonation
 * rather than leaving a second identity lying around on the machine.
 */
import { describeAdminError, toAdminError, type AdminImpersonation } from "./useAdmin";

const KEY = "rep-impersonation";

export interface ImpersonationState {
  /** the admin we return to */
  admin: { accessToken: string; refreshToken: string; email: string | null; id: string };
  target: { userId: string; email: string; deviceId: string; sessionId: string };
  startedAt: number;
  /** epoch ms; the server revokes the shadow session at this point whether we stop or not */
  expiresAt: number;
}

function read(): ImpersonationState | null {
  if (!import.meta.client) return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ImpersonationState) : null;
  } catch { return null; }
}

export function useImpersonation() {
  const supabase = useSupabase();
  const auth = useAuth();
  const admin = useAdmin();
  const state = useState<ImpersonationState | null>("impersonation", () => null);
  const busy = useState<boolean>("impersonation.busy", () => false);
  const error = useState<string | null>("impersonation.error", () => null);

  /** Re-read sessionStorage; called from the banner on mount so a reload keeps the banner up. */
  function restore(): void {
    state.value = read();
  }

  const active = computed(() => !!state.value);

  async function start(userId: string, mint: () => Promise<AdminImpersonation>): Promise<boolean> {
    if (!supabase) { error.value = "Accounts are not configured in this build."; return false; }
    busy.value = true;
    error.value = null;
    try {
      const { data: current } = await supabase.auth.getSession();
      const admin = current.session;
      if (!admin) { error.value = "Your admin session expired. Sign in again."; return false; }

      const grant = await mint();

      const next: ImpersonationState = {
        admin: {
          accessToken: admin.access_token,
          refreshToken: admin.refresh_token,
          email: admin.user.email ?? null,
          id: admin.user.id,
        },
        target: { userId: grant.user_id, email: grant.email, deviceId: grant.device_id, sessionId: grant.session_id },
        startedAt: Date.now(),
        expiresAt: grant.expires_at ? Date.parse(grant.expires_at) : Date.now() + 60 * 60_000,
      };
      sessionStorage.setItem(KEY, JSON.stringify(next));

      // adopt the shadow device *first*: the auth state change that follows will then find the
      // creds already in place and skip register-device entirely.
      await auth.adoptDevice({ deviceId: grant.device_id, sessionId: grant.session_id, userId: grant.user_id });

      const { error: otpError } = await supabase.auth.verifyOtp({ token_hash: grant.token_hash, type: "magiclink" });
      if (otpError) {
        sessionStorage.removeItem(KEY);
        error.value = otpError.message;
        return false;
      }

      state.value = next;
      await navigateTo("/app");
      return true;
    } catch (e) {
      sessionStorage.removeItem(KEY);
      error.value = describeAdminError(toAdminError(e));
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** Put the admin's own session back and return to the user's page in the console. */
  async function stop(): Promise<void> {
    const s = state.value ?? read();
    if (!supabase || !s) { sessionStorage.removeItem(KEY); state.value = null; return; }
    busy.value = true;
    try {
      // the impersonated device creds are left as they are: they are keyed to the target's user id,
      // so authHeaders stops attaching them the moment the admin's session is back, and the admin's
      // own hydrate re-registers their browser normally.
      const { error: setError } = await supabase.auth.setSession({
        access_token: s.admin.accessToken,
        refresh_token: s.admin.refreshToken,
      });
      sessionStorage.removeItem(KEY);
      state.value = null;
      if (setError) {
        // the admin's refresh token expired while we were away; a clean sign-in is the only way back
        await auth.signOut("Your admin session expired while you were viewing as a user.");
        await navigateTo("/signin?next=/admin");
        return;
      }
      // the admin's token is back, so this call authorises as the admin. Revoking server-side
      // matters: otherwise the shadow session stays live until its expiry, usable by anyone who
      // kept the ids.
      await admin.api.users.stopImpersonation(s.target.userId).catch(() => {});
      await navigateTo(`/admin/users/${s.target.userId}`);
    } finally {
      busy.value = false;
    }
  }

  return { active, state, busy, error, start, stop, restore };
}
