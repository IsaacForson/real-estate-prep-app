import { resolveMode, type AppMode } from "~~/lib/study/mode";

/** static (dev, no Supabase) · free (Supabase, signed out) · api (signed in). See lib/study/mode.ts. */
export function useAppMode(): ComputedRef<AppMode> {
  const auth = useAuth();
  return computed(() => resolveMode({ supabaseConfigured: auth.configured, signedIn: !!auth.user.value }));
}
