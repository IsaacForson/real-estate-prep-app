<script setup lang="ts">
/**
 * App shell. All sign-in bookkeeping (device hash, entitlement, study-state hydrate, free tier,
 * RevenueCat identity, events) is registered in useBootstrap and runs inside auth.init() before
 * `auth.ready` flips — pages never see a half-hydrated account (V2 §6.1).
 */
const auth = useAuth();
const bootstrap = useBootstrap();
const purchases = usePurchases();
const route = useRoute();

/** Client-only routes ship an empty document (nuxt.config routeRules). Hold a splash until the session is ready. */
const booting = computed(() => {
  const path = route.path;
  const clientRoute = path === "/account" || path === "/welcome" || path === "/signin"
    || path.startsWith("/app") || path.startsWith("/admin") || path.startsWith("/study") || path.startsWith("/help");
  return clientRoute && !auth.ready.value;
});

onMounted(() => { void bootstrap.start(); });

// RevenueCat identity follows the Supabase user so the webhook can match the entitlement (V2 §6.1 #6).
watch(() => auth.user.value?.id, (id) => {
  if (id && purchases.supported.value) void purchases.configure(id).catch((e) => { if (import.meta.dev) console.warn("[purchases] configure", e); });
});
</script>
<template>
  <!-- outside the layout so it is present on every surface, learner and admin alike -->
  <ClientOnly><ImpersonationBar /></ClientOnly>
  <ClientOnly><AnnouncementBanner /></ClientOnly>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <ClientOnly>
    <BootScreen v-if="booting" />
  </ClientOnly>
</template>
