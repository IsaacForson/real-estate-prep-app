/**
 * Which backend the client talks to, decided at runtime from configuration + auth state.
 *
 *   static  — no NUXT_PUBLIC_SUPABASE_URL. DEV ONLY: items come from public/content/items.json,
 *             there is no auth, no sync and no free-tier gate. This is the dev server / smoke test
 *             mode and must never be what ships to users (SPEC §5.4: never ship the whole bank).
 *   free    — Supabase configured but nobody is signed in. Study is local-only and limited to the
 *             free tier (SPEC §6: 40 questions, one jurisdiction, one short mock).
 *   api     — signed in. Items are signed batches from `issue-batch` (public ids only), progress
 *             and sessions sync to `sync-progress`. Entitlement decides whether the free-tier gate
 *             still applies; the server enforces the same rules regardless of what the client shows.
 */
export type AppMode = "static" | "free" | "api";

export function resolveMode(o: { supabaseConfigured: boolean; signedIn: boolean }): AppMode {
  if (!o.supabaseConfigured) return "static";
  return o.signedIn ? "api" : "free";
}
