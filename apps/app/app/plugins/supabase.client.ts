/**
 * One supabase-js client for the app, or `null` when NUXT_PUBLIC_SUPABASE_URL is not set (static
 * dev mode — see lib/study/mode.ts). Sessions persist in localStorage and refresh in the
 * background so the study path never re-prompts (SPEC F13).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  const url = config.public.supabaseUrl;
  const key = config.public.supabaseAnonKey;
  const supabase: SupabaseClient | null = url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
      })
    : null;
  return { provide: { supabase } };
});
