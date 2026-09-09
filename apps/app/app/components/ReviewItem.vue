<script setup lang="ts">
import type { Item } from "@rep/schema";
import { keyText } from "@rep/schema";
import type { Progress } from "~~/lib/study/types";
/** One missed question, collapsed to its stem; expands to the key, explanation and citation. */
defineProps<{ p: Progress; item: Item | undefined; open: boolean }>();
const emit = defineEmits<{ (e: "toggle"): void }>();
const boxTone = { red: "danger", yellow: "warn", green: "ok" } as const;
const boxDot = { red: "bg-danger", yellow: "bg-warn", green: "bg-ok" };
const stem = (s: string) => s.replace(/\*\*/g, "");
</script>
<template>
  <article class="overflow-hidden rounded-card border border-line bg-surface">
    <button
      type="button"
      class="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
      :aria-expanded="open"
      @click="emit('toggle')"
    >
      <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="boxDot[p.box]" aria-hidden="true" />

      <span class="min-w-0 flex-1">
        <span class="block text-[15px] leading-snug" :class="open ? '' : 'line-clamp-2'">{{ item ? stem(item.stem) : p.itemId }}</span>
        <span class="tabular mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11.5px] text-muted">
          <Badge :tone="boxTone[p.box]">{{ p.box }}</Badge>
          <Badge v-if="p.leech" tone="warn">leech</Badge>
          <span>missed {{ p.misses }}× · {{ p.correct }}/{{ p.attempts }} right</span>
          <span v-if="item" class="truncate">· {{ item.citation.source }}</span>
        </span>
      </span>

      <Icon
        name="chevron-down"
        :size="17"
        class="mt-1 shrink-0 text-muted transition-transform duration-200 ease-standard"
        :class="open ? 'rotate-180' : ''"
      />
    </button>

    <div v-if="open && item" class="grid gap-3.5 border-t border-line bg-paper px-4 py-4">
      <p class="text-[15px] leading-snug"><strong class="font-semibold">{{ item.key }}. {{ keyText(item) }}</strong></p>
      <p class="text-[14px] leading-relaxed text-ink-2">{{ item.explanation }}</p>

      <div v-if="item.math" class="rounded-card border border-line bg-surface p-3.5">
        <p class="eyebrow mb-1.5">Worked solution</p>
        <p class="tabular whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{{ item.math.worked_solution }}</p>
      </div>

      <CitationBlock :source="item.citation.source" :quote="item.citation.quoted_text" :url="item.citation.url" :secondary="item.citation.secondary" />
    </div>
  </article>
</template>
