import type { SupabaseClient } from "@supabase/supabase-js";

/** The client created in plugins/supabase.client.ts; null on the server and in static dev mode. */
export function useSupabase(): SupabaseClient | null {
  return (useNuxtApp().$supabase as SupabaseClient | null | undefined) ?? null;
}
