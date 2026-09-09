<script setup lang="ts">
/**
 * Web shell. Marketing routes get the site nav + footer. Signed-in `/app/**` routes get the app
 * shell: a sidebar from md: up, the bottom tab bar below that, no marketing chrome.
 */
import type { IconName } from "~/components/Icon.vue";
const route = useRoute();
const auth = useAuth();
const studyState = useStudyState();
const isApp = computed(() => route.path === "/app" || route.path.startsWith("/app/"));
const immersive = computed(() => /^\/app\/(study\/practice|mocks\/run)/.test(route.path));
const tabs: Array<{ to: string; label: string; icon: IconName; match: (p: string) => boolean }> = [
  { to: "/app", label: "Home", icon: "home", match: (p) => p === "/app" },
  { to: "/app/study", label: "Study", icon: "book", match: (p) => p.startsWith("/app/study") },
  { to: "/app/mocks", label: "Mocks", icon: "clock", match: (p) => p.startsWith("/app/mocks") },
  { to: "/app/review", label: "Review", icon: "refresh", match: (p) => p.startsWith("/app/review") },
  { to: "/app/glossary", label: "Glossary", icon: "list", match: (p) => p.startsWith("/app/glossary") },
  { to: "/app/account", label: "Account", icon: "user", match: (p) => p.startsWith("/app/account") },
];
</script>
<template>
  <div v-if="isApp" class="min-h-dvh bg-bg text-ink md:grid md:grid-cols-[240px_1fr]">
    <aside class="hidden md:flex flex-col border-r border-line bg-paper sticky top-0 h-dvh p-4 gap-4">
      <NuxtLink to="/app" class="px-2 py-1" aria-label="Home"><BrandMark :size="30" wordmark /></NuxtLink>
      <nav class="grid gap-1" aria-label="App">
        <NuxtLink v-for="t in tabs" :key="t.to" :to="t.to" class="flex items-center gap-3 px-3 min-h-11 rounded-xl text-[15px] font-medium transition-colors" :class="t.match(route.path) ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2'" :aria-current="t.match(route.path) ? 'page' : undefined">
          <Icon :name="t.icon" :size="20" />{{ t.label }}
        </NuxtLink>
      </nav>
      <div class="mt-auto grid gap-1 text-sm">
        <div v-if="studyState.settings.value?.jurisdiction" class="px-3 py-2 rounded-xl bg-surface border border-line text-xs text-muted">Studying <strong class="text-ink">{{ studyState.settings.value.jurisdiction }}</strong> · {{ studyState.settings.value.licenseLevel ?? 'salesperson' }}</div>
        <NuxtLink to="/help" class="flex items-center gap-3 px-3 min-h-10 rounded-xl text-ink-2 hover:bg-surface-2"><Icon name="help" :size="18" />Help</NuxtLink>
        <NuxtLink to="/pricing" class="flex items-center gap-3 px-3 min-h-10 rounded-xl text-ink-2 hover:bg-surface-2"><Icon name="tag" :size="18" />Pricing</NuxtLink>
        <p class="px-3 pt-2 text-xs text-muted truncate">{{ auth.user.value?.email }}</p>
      </div>
    </aside>
    <div class="min-w-0 flex flex-col min-h-dvh">
      <div v-if="!immersive" class="md:hidden"><AppTopBar /></div>
      <AuthBanner />
      <main class="flex-1 w-full max-w-3xl mx-auto safe-px pt-4 md:pt-8" :class="immersive ? 'pb-8' : 'pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-12'">
        <slot />
      </main>
      <div class="md:hidden"><BottomTabBar v-if="!immersive" /></div>
    </div>
    <Toast />
  </div>
  <div v-else class="min-h-dvh bg-bg text-ink flex flex-col">
    <SiteNav />
    <AuthBanner />
    <main class="flex-1"><slot /></main>
    <SiteFooter />
    <Toast />
  </div>
</template>
