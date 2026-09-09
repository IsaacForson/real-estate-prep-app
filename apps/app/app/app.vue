<script setup lang="ts">
/**
 * App shell. All sign-in bookkeeping (device hash, entitlement, study-state hydrate, free tier,
 * RevenueCat identity, events) is registered in useBootstrap and runs inside auth.init() before
 * `auth.ready` flips — pages never see a half-hydrated account (V2 §6.1).
 */
const auth = useAuth();
const bootstrap = useBootstrap();
const purchases = usePurchases();

onMounted(() => { void bootstrap.start(); });

// RevenueCat identity follows the Supabase user so the webhook can match the entitlement (V2 §6.1 #6).
watch(() => auth.user.value?.id, (id) => {
  if (id && purchases.supported.value) void purchases.configure(id).catch(() => {});
});
</script>
<template>
  <!-- outside the layout so it is present on every surface, learner and admin alike -->
  <ClientOnly><ImpersonationBar /></ClientOnly>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
