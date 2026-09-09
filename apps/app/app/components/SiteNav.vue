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
  <header class="sticky top-0 z-30 bg-bg/85 backdrop-blur-md border-b border-line/70">
    <div class="max-w-6xl mx-auto safe-px h-16 flex items-center gap-6">
      <NuxtLink to="/" class="shrink-0" aria-label="Home"><BrandMark :size="30" wordmark /></NuxtLink>
      <nav class="hidden md:flex items-center gap-1 ml-2" aria-label="Site">
        <NuxtLink v-for="l in links" :key="l.to" :to="l.to" class="px-3 py-2 rounded-lg text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink" :class="route.path.startsWith(l.to) ? 'text-ink bg-surface-2' : ''">{{ l.label }}</NuxtLink>
      </nav>
      <div class="flex-1" />
      <div class="hidden md:flex items-center gap-2">
        <AppButton v-if="auth.signedIn.value" to="/app" variant="primary" size="sm" icon-right="arrow-right">Open app</AppButton>
        <template v-else>
          <AppButton to="/signin" variant="ghost" size="sm">Sign in</AppButton>
          <AppButton to="/signin" variant="primary" size="sm">Start free</AppButton>
        </template>
      </div>
      <button type="button" class="md:hidden tap -mr-2 grid place-items-center rounded-lg text-ink" aria-label="Menu" :aria-expanded="open" @click="open = true"><Icon name="menu" :size="24" /></button>
    </div>
    <AppSheet :open="open" title="Menu" @close="open = false">
      <nav class="grid" aria-label="Site">
        <NuxtLink v-for="l in links" :key="l.to" :to="l.to" class="min-h-12 flex items-center px-2 rounded-lg text-[15px] font-medium hover:bg-surface-2">{{ l.label }}</NuxtLink>
        <NuxtLink to="/methodology" class="min-h-12 flex items-center px-2 rounded-lg text-[15px] font-medium hover:bg-surface-2">Methodology</NuxtLink>
      </nav>
      <div class="grid gap-2 mt-3">
        <AppButton v-if="auth.signedIn.value" to="/app" variant="primary" size="lg" block>Open app</AppButton>
        <template v-else>
          <AppButton to="/signin" variant="primary" size="lg" block>Start free</AppButton>
          <AppButton to="/signin" variant="secondary" size="lg" block>Sign in</AppButton>
        </template>
      </div>
    </AppSheet>
  </header>
</template>
