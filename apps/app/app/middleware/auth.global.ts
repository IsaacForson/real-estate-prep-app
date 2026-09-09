/**
 * Auth-first routing (V2 §1, §6.1). Signed-out visitors may open only the public list
 * (lib/state/routes.ts); everything else goes to /welcome. On Capacitor the landing `/` is also
 * /welcome. Runs client-side only: non-public routes are SSR-off (nuxt.config routeRules) and the
 * session lives in the browser, so the server never has to guess.
 */
import { Capacitor } from "@capacitor/core";
import { authRedirect } from "~~/lib/state/routes";

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;
  const auth = useAuth();
  if (!auth.configured) return; // static dev mode: nothing is gated
  await auth.init(); // idempotent; waits for the restored session (+ hydration) on first navigation
  const target = authRedirect({ path: to.path, signedIn: !!auth.user.value, native: Capacitor.isNativePlatform(), authConfigured: auth.configured });
  if (target && target !== to.path) {
    const redirect = to.fullPath && to.fullPath !== "/" ? { path: target, query: { next: to.fullPath } } : target;
    return navigateTo(redirect, { replace: true });
  }
});
