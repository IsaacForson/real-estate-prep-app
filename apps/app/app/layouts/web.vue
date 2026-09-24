<script setup lang="ts">
/**
 * Web shell. Marketing routes get the site nav + footer.
 *
 * Signed-in `/app/**` on a wide screen gets a left sidebar and a wider column, and no top bar.
 * Narrow screens keep the top bar, same as the Android shell. A live mock run is full-screen.
 *
 * The immersive rule lives in composables/useAppPanel.ts so layouts/mobile.vue cannot drift.
 */
const route = useRoute();

const isApp = computed(() => route.path === "/app" || route.path.startsWith("/app/"));
const immersive = computed(() => isImmersivePath(route.path));
</script>
<template>
  <div v-if="isApp" class="app-shell flex min-h-dvh bg-bg text-ink" :class="immersive ? 'is-immersive' : ''">
    <div v-if="!immersive" class="sticky top-0 hidden h-dvh w-[var(--app-sidebar)] shrink-0 md:block">
      <AppSidebar />
    </div>
    <div class="flex min-w-0 flex-1 flex-col">
      <template v-if="!immersive">
        <div class="md:hidden">
          <AppShellHeader :title="appScreenTitle(route.path)" :home="route.path === '/app'" />
        </div>
        <AuthBanner />
      </template>
      <main class="w-full flex-1" :class="immersive ? '' : 'safe-px mx-auto max-w-3xl pt-5 pb-14 md:max-w-[calc(56rem+2rem)] md:pt-8'">
        <slot />
      </main>
    </div>
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
