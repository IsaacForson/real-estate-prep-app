<script setup lang="ts">
import type { IconName } from "./Icon.vue";
/** Fixed bottom navigation for the app shell. Five tabs, 56px rows + safe-area inset. */
const route = useRoute();
const tabs: Array<{ to: string; label: string; icon: IconName; match: (p: string) => boolean }> = [
  { to: "/app", label: "Home", icon: "home", match: (p) => p === "/app" },
  { to: "/app/study", label: "Study", icon: "book", match: (p) => p.startsWith("/app/study") || p.startsWith("/app/glossary") },
  { to: "/app/mocks", label: "Mocks", icon: "clock", match: (p) => p.startsWith("/app/mocks") },
  { to: "/app/review", label: "Review", icon: "refresh", match: (p) => p.startsWith("/app/review") },
  { to: "/app/account", label: "Account", icon: "user", match: (p) => p.startsWith("/app/account") },
];
</script>
<template>
  <nav class="fixed inset-x-0 bottom-0 z-30 bg-surface/92 backdrop-blur-md border-t border-line safe-pb" aria-label="Primary">
    <ul class="grid grid-cols-5 max-w-3xl mx-auto h-14">
      <li v-for="t in tabs" :key="t.to">
        <NuxtLink :to="t.to" class="h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors" :class="t.match(route.path) ? 'text-accent' : 'text-muted hover:text-ink'" :aria-current="t.match(route.path) ? 'page' : undefined">
          <span class="relative grid place-items-center h-7 w-12 rounded-full transition-colors" :class="t.match(route.path) ? 'bg-accent-soft' : ''"><Icon :name="t.icon" :size="21" :stroke-width="t.match(route.path) ? 2.2 : 1.9" /></span>
          {{ t.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
