<script setup lang="ts">
/**
 * App shell for Capacitor.
 *
 * There is no bottom tab bar. `/app` is Home; Practice, mocks, review and the rest get a slim
 * header with a back arrow plus the menu button that raises AppPanel. Only a live mock run is
 * full-screen. Public routes in the native build (pricing, help) keep the plain top bar;
 * welcome and sign-in use the `bare` layout instead.
 *
 * The immersive rule lives in composables/useAppPanel.ts so layouts/web.vue cannot drift from it.
 */
const route = useRoute();

const isApp = computed(() => route.path === "/app" || route.path.startsWith("/app/"));
const immersive = computed(() => isImmersivePath(route.path, true));
const title = computed(() => appScreenTitle(route.path));
</script>
<template>
  <div class="flex min-h-dvh flex-col bg-bg text-ink">
    <template v-if="isApp">
      <template v-if="!immersive">
        <AppShellHeader :title="title" :home="route.path === '/app'" />
        <AuthBanner />
      </template>

      <main class="w-full flex-1" :class="immersive ? '' : 'safe-px mx-auto max-w-3xl pt-4 pb-10'">
        <slot />
      </main>

      <AppChrome />
    </template>

    <template v-else>
      <AppTopBar />
      <AuthBanner />
      <main class="safe-px mx-auto w-full max-w-3xl flex-1 pt-4 pb-10"><slot /></main>
      <Toast />
    </template>
  </div>
</template>
