/**
 * Device registry for the account page (SPEC §5.3): list via the `v_my_devices` view (RLS),
 * self-service removal via `remove-device` (the slot stays busy for 7 days).
 */
import { callFunction, functionsBase } from "~~/lib/study/api";

export interface DeviceRow {
  id: string;
  platform: string;
  name: string | null;
  first_seen: string;
  last_seen: string;
  removed_at: string | null;
  cooldown_until: string | null;
  active: boolean;
  cooling_down: boolean;
  has_live_session: boolean;
}

export function useDevices() {
  const supabase = useSupabase();
  const auth = useAuth();
  const config = useRuntimeConfig();
  const devices = useState<DeviceRow[]>("devices", () => []);
  const loading = useState<boolean>("devices.loading", () => false);
  const error = useState<string | null>("devices.error", () => null);

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

  async function remove(deviceId: string): Promise<{ cooldownUntil: string; signedOutHere: boolean } | null> {
    const headers = await auth.authHeaders();
    if (!headers) return null;
    error.value = null;
    try {
      const res = await callFunction<{ removed: boolean; cooldown_until: string; signed_out_here: boolean }>(
        functionsBase(config.public.supabaseUrl), "remove-device", { device_id: deviceId }, headers,
      );
      if (res.signed_out_here) await auth.signOut("This device was removed from your account.");
      else await refresh();
      return { cooldownUntil: res.cooldown_until, signedOutHere: res.signed_out_here };
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  function isThisDevice(id: string): boolean { return auth.device.value?.deviceId === id; }

  return { devices, loading, error, refresh, remove, isThisDevice };
}
