/**
 * Default layout per shell (V2 §4, §6.1): `mobile` inside Capacitor, `web` in a browser. A page's
 * own `definePageMeta({ layout })` always wins. Falls back to `default` while a layout file is
 * missing. Universal (not .client) so SSR of the public pages picks `web` too and hydration matches;
 * `Capacitor.isNativePlatform()` is false on the server and in browsers.
 */
import { Capacitor } from "@capacitor/core";
import layouts from "#build/layouts";

export default defineNuxtPlugin(() => {
  const available = new Set(Object.keys(layouts as Record<string, unknown>));
  const wanted = Capacitor.isNativePlatform() ? "mobile" : "web";
  const fallback = available.has(wanted) ? wanted : available.has("default") ? "default" : false;
  addRouteMiddleware("shell-layout", (to) => {
    if (to.meta.layout === undefined && fallback) to.meta.layout = fallback;
  }, { global: true });
});
