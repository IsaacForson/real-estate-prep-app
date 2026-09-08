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
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? "",
      contentBase: "/content",
    },
  },
  typescript: { strict: true, typeCheck: false },
  vite: { server: { fs: { allow: [".."] } } },
});
