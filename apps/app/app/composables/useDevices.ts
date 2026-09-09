/**
 * Device registry for the account page (SPEC §5.3): list via the `v_my_devices` view (RLS).
 *
 * Up to `max_active_devices` (default 2, 0022) may be active at once; signing in on one more evicts
 * the least recently seen. `remove` signs a device out immediately (no cooldown) — the slot frees at
 * once and signing in on it again simply registers it afresh.
 */
import { callFunction, functionsBase } from "~~/lib/study/api";
import { DEFAULT_MAX_DEVICES } from "./useAuth";

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
  /** the account-wide ceiling (app_settings.device_policy via v_app_runtime); falls back to the shipped default */
  const maxActive = useState<number>("devices.maxActive", () => DEFAULT_MAX_DEVICES);

  /** Devices holding a slot right now, this device first, then most recently seen. */
  const active = computed(() => {
    const mine = auth.device.value?.deviceId ?? null;
    return devices.value
      .filter((d) => d.active)
      .sort((a, b) => (a.id === mine ? -1 : b.id === mine ? 1 : Date.parse(b.last_seen) - Date.parse(a.last_seen)));
  });
  /** The device this install is signed in on, if it is in the list. */
  const current = computed(() => active.value.find((d) => d.id === auth.device.value?.deviceId) ?? active.value[0] ?? null);

  async function refresh(): Promise<void> {
    if (!supabase || !auth.user.value) { devices.value = []; return; }
    loading.value = true;
    error.value = null;
    try {
      const [list, runtime] = await Promise.all([
        supabase.from("v_my_devices").select("*").order("last_seen", { ascending: false }),
        supabase.from("v_app_runtime").select("max_active_devices").maybeSingle(),
      ]);
      if (list.error) { error.value = list.error.message; return; }
      devices.value = (list.data ?? []) as DeviceRow[];
      const n = Number((runtime.data as { max_active_devices?: number } | null)?.max_active_devices);
      if (Number.isFinite(n) && n >= 1) { maxActive.value = n; auth.maxDevices.value = n; }
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

  return { devices, active, current, maxActive, loading, error, refresh, remove, isThisDevice };
}
