<script setup lang="ts">
const settings = useSettings();
const auth = useAuth();
const entitlement = useEntitlement();
const sync = useSync();
const freeTier = useFreeTier();

onMounted(async () => {
  settings.restore();
  applyTheme();
  void freeTier.load();
  // auth is a no-op in static dev mode (no NUXT_PUBLIC_SUPABASE_URL) — see lib/study/mode.ts
  await auth.init();
  sync.start();
});
watch(() => settings.theme, applyTheme);

// signed-in bookkeeping: entitlement (kv cache → network), home state for the free tier, the
// sharing-notice ack, and a catch-up sync. None of it touches the study path (F7/F13).
watch(() => auth.user.value?.id, async (id) => {
  await entitlement.load();
  if (!id) return;
  if (settings.jurisdiction) void entitlement.setHomeJurisdiction(settings.jurisdiction);
  if (entitlement.profile.value?.sharing_notice_ack && !settings.sharingNoticeAck) settings.set("sharingNoticeAck", true);
  else if (settings.sharingNoticeAck && entitlement.profile.value && !entitlement.profile.value.sharing_notice_ack) void entitlement.ackSharingNotice();
  void sync.syncNow();
});
watch(() => settings.jurisdiction, (code) => { if (code && auth.user.value) void entitlement.setHomeJurisdiction(code); });

function applyTheme() {
  if (!import.meta.client) return;
  const root = document.documentElement;
  if (settings.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", settings.theme);
}
</script>
<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
