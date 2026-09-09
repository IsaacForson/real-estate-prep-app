<script setup lang="ts">
import type { Item } from "@rep/schema";
import { keyText } from "@rep/schema";
import type { Progress } from "~~/lib/study/types";
/** One missed question, collapsed to its stem; expands to the key, explanation and citation. */
defineProps<{ p: Progress; item: Item | undefined; open: boolean }>();
const emit = defineEmits<{ (e: "toggle"): void }>();
const boxTone = { red: "danger", yellow: "warn", green: "ok" } as const;
const stem = (s: string) => s.replace(/\*\*/g, "");
</script>
<template>
  <article class="rounded-card bg-surface border border-line overflow-hidden">
    <button type="button" class="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-surface-2" :aria-expanded="open" @click="emit('toggle')">
      <span class="mt-1 size-2.5 rounded-full shrink-0" :class="{ red: 'bg-danger', yellow: 'bg-warn', green: 'bg-ok' }[p.box]" aria-hidden="true" />
      <span class="flex-1 min-w-0">
        <span class="block text-[15px] leading-snug" :class="open ? '' : 'line-clamp-2'">{{ item ? stem(item.stem) : p.itemId }}</span>
        <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted tabular">
          <Badge :tone="boxTone[p.box]">{{ p.box }}</Badge><Badge v-if="p.leech" tone="warn">leech</Badge>
          <span>missed {{ p.misses }}× · {{ p.correct }}/{{ p.attempts }} right</span>
          <span v-if="item" class="truncate">· {{ item.citation.source }}</span>
        </span>
      </span>
      <Icon name="chevron-down" :size="18" class="text-muted shrink-0 transition-transform" :class="open ? 'rotate-180' : ''" />
    </button>
    <div v-if="open && item" class="border-t border-line bg-paper px-4 py-4 grid gap-3">
      <p class="text-[15px]"><strong>{{ item.key }}. {{ keyText(item) }}</strong></p>
      <p class="text-sm text-ink-2 leading-relaxed">{{ item.explanation }}</p>
      <div v-if="item.math" class="rounded-xl bg-surface-2 p-3 text-sm"><p class="eyebrow mb-1">Worked solution</p><p class="whitespace-pre-line tabular">{{ item.math.worked_solution }}</p></div>
      <CitationBlock :source="item.citation.source" :quote="item.citation.quoted_text" :url="item.citation.url" :secondary="item.citation.secondary" />
    </div>
  </article>
</template>
