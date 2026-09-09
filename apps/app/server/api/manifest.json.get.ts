/**
 * Serves the content manifest built by scripts/build-content-manifest.ts. Read from Nitro server
 * assets so it works in `nuxt dev`, the Node server, and is prerendered to a static JSON file by
 * `nuxt generate` (which is what Capacitor ships).
 *
 * The route keeps its `.json` extension on purpose. Capacitor's Android local server types a
 * static asset from its file extension (`URLConnection.guessContentTypeFromName`) and only falls
 * back to sniffing the bytes, which does not recognise JSON. Served as `/api/manifest` the
 * prerendered file therefore arrived with no `application/json` content type and ofetch handed the
 * caller the raw string instead of an object — see the note in composables/useContent.ts.
 */
export default defineEventHandler(async () => {
  const storage = useStorage("assets:server");
  const raw = await storage.getItem("content/manifest.json");
  if (!raw) throw createError({ statusCode: 503, statusMessage: "Content manifest not built — run `pnpm --filter @rep/app content:manifest`" });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
});
