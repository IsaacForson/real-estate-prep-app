/**
 * Serves the content manifest built by scripts/build-content-manifest.ts. Read from Nitro server
 * assets so it works in `nuxt dev`, the Node server, and is prerendered to a static JSON file by
 * `nuxt generate` (which is what Capacitor ships).
 */
export default defineEventHandler(async () => {
  const storage = useStorage("assets:server");
  const raw = await storage.getItem("content/manifest.json");
  if (!raw) throw createError({ statusCode: 503, statusMessage: "Content manifest not built — run `pnpm --filter @rep/app content:manifest`" });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
});
