/**
 * Registers the sign-in / sign-out hooks (composables/useBootstrap.ts) before the router's first
 * navigation, so `middleware/auth.global.ts` → `auth.init()` hydrates entitlement, device and study
 * state before any page renders. app.vue then calls `useBootstrap().start()` on mount.
 */
export default defineNuxtPlugin({
  name: "bootstrap",
  // useRepo() needs the supabase client this plugin's composables read from nuxtApp.$supabase
  dependsOn: ["supabase"],
  setup() {
    useBootstrap();
  },
});
