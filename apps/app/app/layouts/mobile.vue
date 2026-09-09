<script setup lang="ts">
/**
 * App shell for Capacitor: top bar with title/context, content, fixed bottom tabs with safe-area
 * insets. Practice and mock runs are "immersive" — they draw their own header and hide the tab bar
 * so the question owns the screen. Signed-out visitors (welcome/sign-in are `bare`; pricing/help
 * are public) get no tab bar.
 */
const route = useRoute();
const auth = useAuth();
const immersive = computed(() => /^\/app\/(study\/practice|mocks\/run)/.test(route.path));
const tabs = computed(() => !immersive.value && auth.signedIn.value);
</script>
<template>
  <div class="min-h-dvh bg-bg text-ink flex flex-col">
    <template v-if="!immersive">
      <AppTopBar />
      <AuthBanner />
    </template>
    <main class="flex-1 w-full max-w-3xl mx-auto safe-px" :class="immersive ? 'pb-6' : tabs ? 'pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]' : 'pt-4 pb-8'">
      <slot />
    </main>
    <BottomTabBar v-if="tabs" />
    <Toast />
  </div>
</template>
