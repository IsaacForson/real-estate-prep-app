<script setup lang="ts">
import type { Item, OptionLetter } from "@rep/schema";
import { OPTION_LETTERS } from "@rep/schema";
/**
 * One question: meta line, stem, four OptionButtons, and after reveal the verdict, explanation,
 * worked solution and the CitationBlock. `reveal=false` is the mock mode (no feedback).
 */
const props = defineProps<{ item: Item; answered: OptionLetter | null; reveal: boolean; number?: number; total?: number }>();
const emit = defineEmits<{ (e: "choose", letter: OptionLetter): void }>();

function state(letter: OptionLetter): "idle" | "selected" | "correct" | "wrong" | "dimmed" {
  if (!props.reveal) return props.answered === letter ? "selected" : "idle";
  if (letter === props.item.key) return "correct";
  if (props.answered === letter) return "wrong";
  return "dimmed";
}
const stemHtml = computed(() => props.item.stem.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"));
const bankLabel = computed(() => props.item.bank.replace("national_pearsonvue", "National · Pearson VUE").replace("national_psi", "National · PSI").replace(/^state_/, "State · "));
const correct = computed(() => props.answered === props.item.key);
</script>
<template>
  <article class="rounded-card bg-surface border border-line shadow-card overflow-hidden">
    <div class="px-4 sm:px-5 pt-4 flex items-center justify-between gap-2 text-xs text-muted">
      <span class="truncate">{{ bankLabel }} · {{ item.blueprint_node }}</span>
      <Badge tone="outline">{{ item.cognitive_level }}</Badge>
    </div>
    <div class="px-4 sm:px-5 pt-2 pb-4">
      <p v-if="number" class="eyebrow mb-1">Question {{ number }}<template v-if="total"> of {{ total }}</template></p>
      <p class="text-[18px] sm:text-[19px] leading-snug font-medium rich" v-html="stemHtml" />
    </div>
    <div class="px-3 sm:px-4 pb-4 grid gap-2" role="group" aria-label="Answer options">
      <OptionButton v-for="(opt, i) in item.options" :key="i" :letter="OPTION_LETTERS[i]!" :text="opt" :state="state(OPTION_LETTERS[i]!)" :disabled="reveal" @choose="emit('choose', OPTION_LETTERS[i]!)" />
    </div>
    <Transition enter-active-class="transition duration-200" enter-from-class="opacity-0 translate-y-1">
      <div v-if="reveal" class="border-t border-line bg-paper px-4 sm:px-5 py-4 grid gap-3" aria-live="polite">
        <div class="flex items-center gap-2">
          <span class="grid place-items-center size-7 rounded-full" :class="correct ? 'bg-ok text-white' : 'bg-danger text-white'"><Icon :name="correct ? 'check' : 'x'" :size="16" :stroke-width="2.6" /></span>
          <strong class="text-[15px]">{{ correct ? 'Correct.' : `Not quite — the answer is ${item.key}.` }}</strong>
        </div>
        <p class="text-[15px] leading-relaxed text-ink-2">{{ item.explanation }}</p>
        <div v-if="item.math" class="rounded-xl bg-surface-2 p-3 text-sm">
          <p class="eyebrow mb-1">Worked solution</p>
          <p class="whitespace-pre-line tabular">{{ item.math.worked_solution }}</p>
        </div>
        <CitationBlock :source="item.citation.source" :quote="item.citation.quoted_text" :url="item.citation.url" :secondary="item.citation.secondary" />
        <slot name="after-reveal" />
      </div>
    </Transition>
  </article>
</template>
