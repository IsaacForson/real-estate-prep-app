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
  <div class="safe-px anim-fade-up mx-auto grid max-w-3xl gap-6 py-8 md:py-14">
    <nav class="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" aria-label="Legal pages">
      <NuxtLink
        v-for="p in pages"
        :key="p.to"
        :to="p.to"
        class="inline-flex min-h-9 shrink-0 items-center rounded-pill border px-3.5 text-[13px] font-medium transition-colors"
        :class="route.path === p.to
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink'"
        :aria-current="route.path === p.to ? 'page' : undefined"
      >{{ p.label }}</NuxtLink>
    </nav>

    <header class="grid gap-2.5">
      <p class="eyebrow">Legal</p>
      <h1 class="display text-[32px] md:text-[42px]">{{ title }}</h1>
      <p class="text-[13px] text-muted">Effective {{ updated }} · Forsare Ventures Ltd</p>
      <p v-if="intro" class="mt-1 text-[15px] leading-relaxed text-ink-2">{{ intro }}</p>
    </header>

    <AppCard padding="lg" class="rich text-[14.5px] leading-relaxed text-ink-2"><slot /></AppCard>
  </div>
</template>
