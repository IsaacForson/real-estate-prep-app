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
  // Marketing / state pages render on the server for SEO; the study app is client-only
  // (offline-first, local store) and is also what Capacitor ships.
  routeRules: {
    "/study/**": { ssr: false },
    // account + auth callback read the local store and the supabase session: client-only too
    "/account": { ssr: false },
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? "",
      contentBase: "/content",
      revenuecatGoogleKey: process.env.NUXT_PUBLIC_REVENUECAT_GOOGLE_KEY ?? "",
      revenuecatAppleKey: process.env.NUXT_PUBLIC_REVENUECAT_APPLE_KEY ?? "",
      // Empty by default → "static" dev mode (no auth, local items). Set both to talk to apps/api.
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL ?? "",
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    },
  },
  typescript: { strict: true, typeCheck: false },
  vite: { server: { fs: { allow: [".."] } } },
});
