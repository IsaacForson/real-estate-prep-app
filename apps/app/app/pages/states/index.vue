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
  <div class="safe-px anim-fade-up mx-auto grid max-w-6xl gap-7 py-8 md:py-16">
    <header class="grid max-w-2xl gap-3">
      <p class="eyebrow">States</p>
      <h1 class="display text-[32px] md:text-[42px]">Every state's exam, from the official bulletin.</h1>
      <p class="text-[15px] leading-relaxed text-ink-2">
        Vendor, question counts, time limit, pass score and the law you'll be tested on — sourced from
        the state commission and the vendor's candidate bulletin, never a blog. Content status is the
        real count.
      </p>
    </header>

    <AppInput
      v-model="q"
      type="search"
      placeholder="Find your state"
      inputmode="search"
      autocomplete="off"
      aria-label="Find your state"
      class="max-w-md"
    />

    <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <li v-for="c in list" :key="c">
        <NuxtLink
          :to="`/states/${c}`"
          class="flex items-center gap-3.5 rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-2"
        >
          <span class="tabular grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-[13px] font-semibold text-accent">{{ c }}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[15px] font-semibold tracking-[-0.012em]">{{ JURISDICTIONS[c] }}</span>
            <span class="block text-[11.5px] text-muted">
              {{ manifest?.states[c]?.vendor ?? '—' }}<template v-if="manifest?.states[c]?.salesperson_exam.total_items"> · {{ manifest?.states[c]?.salesperson_exam.total_items }} questions</template>
            </span>
          </span>
          <Badge :tone="status(c).tone">{{ status(c).label }}</Badge>
        </NuxtLink>
      </li>
    </ul>

    <p class="max-w-2xl text-[13px] leading-relaxed text-muted">
      A state marked "in production" is included in Complete and its questions arrive as they pass
      verification. Nothing here is padded to look finished.
    </p>
  </div>
</template>
