<script setup lang="ts">
/**
 * Web shell. Marketing routes get the site nav + footer.
 *
 * Signed-in `/app/**` routes get the same shell as the native build: no sidebar and no tab bar,
 * because the study loop is the product and permanent navigation furniture would only push it off
 * the screen. `/app` is the loop and owns everything; secondary screens get the slim header. On
 * wide viewports the content is simply centred in a reading column rather than sat next to a rail.
 *
 * The immersive rule lives in composables/useAppPanel.ts so layouts/mobile.vue cannot drift.
 */
const route = useRoute();

const isApp = computed(() => route.path === "/app" || route.path.startsWith("/app/"));
const immersive = computed(() => isImmersivePath(route.path));
const title = computed(() => appScreenTitle(route.path));
</script>
<template>
  <div v-if="isApp" class="flex min-h-dvh flex-col bg-bg text-ink">
    <template v-if="!immersive">
      <AppShellHeader :title="title" :home="route.path === '/app'" />
      <AuthBanner />
    </template>

    <main class="w-full flex-1" :class="immersive ? '' : 'safe-px mx-auto max-w-3xl pt-5 pb-14 md:pt-8'">
      <slot />
    </main>

    <AppChrome />
  </div>

  <div v-else class="flex min-h-dvh flex-col bg-bg text-ink">
    <SiteNav />
    <AuthBanner />
    <main class="flex-1"><slot /></main>
    <SiteFooter />
    <Toast />
  </div>
</template>
