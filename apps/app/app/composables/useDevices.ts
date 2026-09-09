/**
 * Device registry for the account page (SPEC §5.3): list via the `v_my_devices` view (RLS).
 *
 * Since 0015 an account has one active device and the newest sign-in takes it over, so this is
 * mostly a history list. `remove` is still useful for "sign out the laptop I left at the office";
 * the slot frees immediately, so signing back in on it just moves the account back.
 */
import { callFunction, functionsBase } from "~~/lib/study/api";

export interface DeviceRow {
  id: string;
  platform: string;
  name: string | null;
  first_seen: string;
  last_seen: string;
  removed_at: string | null;
  active: boolean;
  has_live_session: boolean;
}

export function useDevices() {
  const supabase = useSupabase();
  const auth = useAuth();
  const config = useRuntimeConfig();
  const devices = useState<DeviceRow[]>("devices", () => []);
  const loading = useState<boolean>("devices.loading", () => false);
  const error = useState<string | null>("devices.error", () => null);

  /** The device currently holding the slot, if any. */
  const current = computed(() => devices.value.find((d) => d.active) ?? null);

  async function refresh(): Promise<void> {
    if (!supabase || !auth.user.value) { devices.value = []; return; }
    loading.value = true;
    error.value = null;
    try {
      const { data, error: err } = await supabase.from("v_my_devices").select("*").order("last_seen", { ascending: false });
      if (err) { error.value = err.message; return; }
      devices.value = (data ?? []) as DeviceRow[];
    } finally {
      loading.value = false;
    }
  }

  async function remove(deviceId: string): Promise<{ removedAt: string; signedOutHere: boolean } | null> {
    const headers = await auth.authHeaders();
    if (!headers) return null;
    error.value = null;
    try {
      const res = await callFunction<{ removed: boolean; removed_at: string; signed_out_here: boolean }>(
        functionsBase(config.public.supabaseUrl), "remove-device", { device_id: deviceId }, headers,
      );
      if (res.signed_out_here) await auth.signOut("This device was signed out of your account.");
      else await refresh();
      return { removedAt: res.removed_at, signedOutHere: res.signed_out_here };
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  function isThisDevice(id: string): boolean { return auth.device.value?.deviceId === id; }

  return { devices, current, loading, error, refresh, remove, isThisDevice };
}
