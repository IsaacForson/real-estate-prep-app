<script setup lang="ts">
/** Marketing top nav (web only). Collapses to a sheet below md. */
const auth = useAuth();
const open = ref(false);
const route = useRoute();
const links = [
  { to: "/states", label: "States" },
  { to: "/pricing", label: "Pricing" },
  { to: "/reviews", label: "Reviews" },
  { to: "/help", label: "Help" },
];
watch(() => route.fullPath, () => { open.value = false; });
</script>
<template>
  <header class="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
    <div class="safe-px mx-auto flex h-16 max-w-6xl items-center gap-6">
      <NuxtLink to="/" class="shrink-0" aria-label="CitePass home"><BrandMark :size="28" wordmark /></NuxtLink>

      <nav class="ml-1 hidden items-center gap-0.5 md:flex" aria-label="Site">
        <NuxtLink
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          class="rounded-lg px-3 py-2 text-[14px] font-medium transition-colors"
          :class="route.path.startsWith(l.to) ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'"
        >{{ l.label }}</NuxtLink>
      </nav>

      <div class="flex-1" />

      <div class="hidden items-center gap-2 md:flex">
        <!-- client-only: the preference lives in localStorage, so SSR would render the wrong icon -->
        <ClientOnly>
          <ThemeToggle />
          <template #fallback><span class="size-11" aria-hidden="true" /></template>
        </ClientOnly>
        <AppButton v-if="auth.signedIn.value" to="/app" variant="primary" size="sm" icon-right="arrow-right">Open app</AppButton>
        <template v-else>
          <AppButton to="/signin" variant="ghost" size="sm">Sign in</AppButton>
          <AppButton to="/signin" variant="primary" size="sm">Start free</AppButton>
        </template>
      </div>

      <ClientOnly>
        <ThemeToggle class="-mr-1 md:hidden" />
        <template #fallback><span class="size-11 md:hidden" aria-hidden="true" /></template>
      </ClientOnly>

      <button
        type="button"
        class="tap -mr-2 grid place-items-center rounded-lg text-ink md:hidden"
        aria-label="Menu"
        :aria-expanded="open"
        @click="open = true"
      ><Icon name="menu" :size="22" /></button>
    </div>

    <AppSheet :open="open" title="Menu" @close="open = false">
      <nav class="grid" aria-label="Site">
        <NuxtLink
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          class="flex min-h-12 items-center rounded-lg px-2 text-[15px] font-medium transition-colors hover:bg-surface-2"
        >{{ l.label }}</NuxtLink>
        <NuxtLink to="/methodology" class="flex min-h-12 items-center rounded-lg px-2 text-[15px] font-medium transition-colors hover:bg-surface-2">Methodology</NuxtLink>
      </nav>
      <div class="mt-4 border-t border-line pt-4">
        <p class="eyebrow mb-2">Appearance</p>
        <ClientOnly><ThemeToggle variant="tabs" /></ClientOnly>
      </div>

      <div class="mt-4 grid gap-2 border-t border-line pt-4">
        <AppButton v-if="auth.signedIn.value" to="/app" variant="primary" size="lg" block icon-right="arrow-right">Open app</AppButton>
        <template v-else>
          <AppButton to="/signin" variant="primary" size="lg" block>Start free</AppButton>
          <AppButton to="/signin" variant="secondary" size="lg" block>Sign in</AppButton>
        </template>
      </div>
    </AppSheet>
  </header>
</template>
