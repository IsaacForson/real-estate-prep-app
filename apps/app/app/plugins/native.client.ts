/**
 * Native shell behaviour with no web equivalent: the Android hardware back button, and holding the
 * launch splash until the app is actually usable.
 *
 * Both were reported as bugs on device. Back closed the app outright, because without
 * `@capacitor/app` registering a `backButton` listener Capacitor falls through to finishing the
 * activity. And a cold launch showed a blank shell for a second or two while Nuxt booted and
 * `auth.init()` hydrated the session, which reads as a glitch rather than as loading.
 */
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";

export default defineNuxtPlugin(() => {
  if (!Capacitor.isNativePlatform()) return;
  const router = useRouter();
  const auth = useAuth();

  App.addListener("backButton", ({ canGoBack }) => {
    // An overlay is the most recent thing the learner opened, so it is what back should dismiss.
    // AppPanel, AppSheet and StatePicker all render role="dialog" and already close on Escape, so
    // reusing that keeps one dismissal path instead of a second one that could drift from it.
    if (document.querySelector('[role="dialog"]')) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      return;
    }
    const path = router.currentRoute.value.path;
    if (canGoBack && path !== "/app") { router.back(); return; }
    // Deeper screens reached without history (a redirect, a cold launch straight into one) go Home
    // rather than closing the app.
    if (path !== "/app") { void navigateTo("/app"); return; }
    // On Home, back should background the app the way every other Android app does — not kill it,
    // which would drop the session the learner is mid-way through.
    void App.minimizeApp();
  });

  // `auth.ready` flips only after the session, device and entitlement are hydrated, so hiding on it
  // means the first frame the learner sees is the real destination.
  const stop = watch(auth.ready, (ready) => {
    if (!ready) return;
    stop();
    void SplashScreen.hide({ fadeOutDuration: 250 });
  }, { immediate: true });

  // Never leave the splash up for ever if bootstrap stalls (no network, a wedged request): the app
  // behind it still works, and a stuck splash is worse than an empty screen.
  setTimeout(() => void SplashScreen.hide({ fadeOutDuration: 250 }), 8000);
});
