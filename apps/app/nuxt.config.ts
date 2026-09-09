import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-09-01",
  modules: ["@pinia/nuxt"],
  css: ["~/assets/main.css"],
  app: {
    head: {
      title: "Real Estate Exam Prep",
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
        { name: "color-scheme", content: "light dark" },
      ],
    },
  },
  // Marketing / state pages render on the server for SEO (V2 §1 public list). Everything that needs
  // the session or the local cache is client-only and is also what Capacitor ships.
  //
  // `CAPACITOR_BUILD=1` (set by scripts/android-setup.sh before `nuxt generate`) also drops "/" out
  // of SSR for that one build. Capacitor's WebView always paints whatever file prerendering wrote
  // for "/" as its very first frame, before Vue mounts or the auth middleware can run — normally
  // that is the fully-rendered marketing landing page. On a cold app launch that showed as a flash
  // of the website before the app redirected to /welcome or /app. With "/" client-only in this
  // build, that first frame is the bare shell instead, and the very first thing to actually paint
  // is the real destination.
  routeRules: {
    ...(process.env.CAPACITOR_BUILD ? { "/": { ssr: false } } : {}),
    "/app/**": { ssr: false },
    "/admin/**": { ssr: false },
    "/study/**": { ssr: false },
    "/account": { ssr: false },
    "/welcome": { ssr: false },
    "/signin": { ssr: false },
    "/help/**": { ssr: false },
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? "",
      contentBase: "/content",
      revenuecatGoogleKey: process.env.NUXT_PUBLIC_REVENUECAT_GOOGLE_KEY ?? "",
      revenuecatAppleKey: process.env.NUXT_PUBLIC_REVENUECAT_APPLE_KEY ?? "",
      checkoutCompleteUrl: process.env.NUXT_PUBLIC_CHECKOUT_COMPLETE_URL ?? "",
      checkoutGuaranteeUrl: process.env.NUXT_PUBLIC_CHECKOUT_GUARANTEE_URL ?? "",
      // Empty by default → "static" dev mode (no auth, local items). Set both to talk to apps/api.
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL ?? "",
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    },
  },
  nitro: {
    // /api/manifest has no params, so bake it as a static JSON file unconditionally — it must not
    // depend on Nitro's link-crawler discovering it, which only ever happened via the fully-rendered
    // marketing "/" page. Inside the packaged native app "/" is a bare shell (see the CAPACITOR_BUILD
    // note above), so without this the manifest fetch 404s in the shipped app with no live server.
    prerender: { routes: ["/api/manifest"] },
  },
  typescript: { strict: true, typeCheck: false },
  vite: {
    plugins: [
      tailwindcss(),
      // zod v4's JSON-schema module declares a top-level `function process`; Vite inlines it into the SSR
      // bundle, where Nitro's `import process from "node:process"` intro then collides with it (SyntaxError at
      // prerender). Rename the identifier inside that one module.
      {
        name: "rename-zod-process",
        enforce: "pre" as const,
        transform(code: string, id: string) {
          if (!/[\\/]zod[\\/].*to-json-schema/.test(id) || !code.includes("function process(")) return null;
          return { code: code.replace(/(?<![.\w$])process(?![\w$])/g, "zodProcess") + "\nexport { zodProcess as process };\n", map: null };
        },
      },
    ],
    server: { fs: { allow: [".."] } },
  },
});
