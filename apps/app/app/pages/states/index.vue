<script setup lang="ts">
import { JURISDICTIONS, JURISDICTION_CODES } from "@rep/schema";
/** All 51 jurisdictions with vendor and honest content status; each links to its exam brief. */
useHead({ title: "Real estate exam by state — format, vendor, pass score for all 50 states + DC" });
const content = useContent();
const { data: manifest } = await useAsyncData("manifest", () => content.load());
const q = ref("");
const list = computed(() => { const n = q.value.trim().toLowerCase(); return JURISDICTION_CODES.filter((c) => !n || c.toLowerCase().includes(n) || JURISDICTIONS[c].toLowerCase().includes(n)); });
function status(code: string) {
  const s = manifest.value?.status[code];
  if (!s) return { label: "planned", tone: "outline" as const };
  if (s.phase === "complete") return { label: `${s.published} questions`, tone: "ok" as const };
  if (s.verified + s.published > 0) return { label: `${s.verified + s.published} verified · in production`, tone: "warn" as const };
  return { label: "in production", tone: "outline" as const };
}
</script>
<template>
  <div class="max-w-6xl mx-auto safe-px py-8 md:py-14 grid gap-6 anim-fade-up">
    <header class="grid gap-2 max-w-2xl">
      <p class="eyebrow text-accent">States</p>
      <h1 class="text-3xl md:text-4xl display">Every state's exam, from the official bulletin.</h1>
      <p class="text-ink-2">Vendor, question counts, time limit, pass score and the law you'll be tested on — sourced from the state commission and the vendor's candidate bulletin, never a blog. Content status is the real count.</p>
    </header>
    <AppInput v-model="q" type="search" placeholder="Find your state" inputmode="search" autocomplete="off" aria-label="Find your state" class="max-w-md" />
    <ul class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <li v-for="c in list" :key="c">
        <NuxtLink :to="`/states/${c}`" class="flex items-center gap-3 rounded-card bg-surface border border-line p-4 hover:border-line-strong hover:bg-surface-2 transition-colors">
          <span class="grid place-items-center size-10 rounded-lg bg-accent-soft text-accent text-sm font-semibold tabular">{{ c }}</span>
          <span class="flex-1 min-w-0"><span class="block font-semibold truncate">{{ JURISDICTIONS[c] }}</span><span class="block text-xs text-muted">{{ manifest?.states[c]?.vendor ?? '—' }}<template v-if="manifest?.states[c]?.salesperson_exam.total_items"> · {{ manifest?.states[c]?.salesperson_exam.total_items }} questions</template></span></span>
          <Badge :tone="status(c).tone">{{ status(c).label }}</Badge>
        </NuxtLink>
      </li>
    </ul>
    <p class="text-sm text-muted">A state marked "in production" is included in Complete and its questions arrive as they pass verification. Nothing here is padded to look finished.</p>
  </div>
</template>
