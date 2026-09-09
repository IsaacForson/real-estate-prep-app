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
  routeRules: {
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
