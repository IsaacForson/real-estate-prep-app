<script setup lang="ts">
/** Shared frame for the legal pages: title, effective date, sibling nav, prose. */
defineProps<{ title: string; updated: string; intro?: string }>();
const route = useRoute();
const pages = [
  { to: "/legal/terms", label: "Terms" }, { to: "/legal/privacy", label: "Privacy" },
  { to: "/legal/refunds", label: "Refunds & guarantee" }, { to: "/legal/disclaimer", label: "Disclaimer" },
];
</script>
<template>
  <div class="max-w-3xl mx-auto safe-px py-8 md:py-14 grid gap-6 anim-fade-up">
    <nav class="flex gap-1 overflow-x-auto no-scrollbar -mx-4 px-4" aria-label="Legal pages">
      <NuxtLink v-for="p in pages" :key="p.to" :to="p.to" class="min-h-9 px-3 inline-flex items-center rounded-pill text-sm font-medium shrink-0" :class="route.path === p.to ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-2 hover:text-ink'">{{ p.label }}</NuxtLink>
    </nav>
    <header class="grid gap-2">
      <p class="eyebrow text-accent">Legal</p>
      <h1 class="text-3xl md:text-4xl display">{{ title }}</h1>
      <p class="text-sm text-muted">Effective {{ updated }} · Forsare Ventures Ltd</p>
      <p v-if="intro" class="text-ink-2">{{ intro }}</p>
    </header>
    <AppCard padding="lg" class="rich text-ink-2 text-[15px]"><slot /></AppCard>
  </div>
</template>
