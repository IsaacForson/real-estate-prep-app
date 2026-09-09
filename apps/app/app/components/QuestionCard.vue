<script setup lang="ts">
import type { Item, OptionLetter } from "@rep/schema";
import { OPTION_LETTERS } from "@rep/schema";
/**
 * One question: meta line, stem, four OptionButtons, and after reveal the verdict, explanation,
 * worked solution and the CitationBlock. `reveal=false` is the mock mode (no feedback).
 *
 * The stem is the largest text on the screen and the card carries no decoration that competes
 * with it — during a session the question is the interface.
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
  <article class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
    <div class="flex items-center justify-between gap-2 border-b border-line bg-paper px-4 py-2 text-[11.5px] text-muted sm:px-5">
      <span class="truncate">{{ bankLabel }} · {{ item.blueprint_node }}</span>
      <Badge tone="outline">{{ item.cognitive_level }}</Badge>
    </div>

    <div class="px-4 pt-4 pb-4 sm:px-5">
      <p v-if="number" class="eyebrow mb-2">Question {{ number }}<template v-if="total"> of {{ total }}</template></p>
      <p class="rich text-[18px] font-medium leading-[1.45] tracking-[-0.011em] text-ink sm:text-[19px]" v-html="stemHtml" />
    </div>

    <div class="grid gap-2 px-3 pb-4 sm:px-4" role="group" aria-label="Answer options">
      <OptionButton
        v-for="(opt, i) in item.options"
        :key="i"
        :letter="OPTION_LETTERS[i]!"
        :text="opt"
        :state="state(OPTION_LETTERS[i]!)"
        :disabled="reveal"
        @choose="emit('choose', OPTION_LETTERS[i]!)"
      />
    </div>

    <Transition
      enter-active-class="transition duration-200 ease-emphasized"
      enter-from-class="opacity-0 -translate-y-1"
    >
      <div v-if="reveal" class="grid gap-3.5 border-t border-line bg-paper px-4 py-4 sm:px-5" aria-live="polite">
        <div class="flex items-center gap-2.5">
          <span
            class="grid size-6 shrink-0 place-items-center rounded-full"
            :class="correct ? 'bg-ok text-white' : 'bg-danger text-white'"
          ><Icon :name="correct ? 'check' : 'x'" :size="14" :stroke-width="3" /></span>
          <strong class="text-[15px] tracking-[-0.011em]">{{ correct ? 'Correct.' : `Not quite — the answer is ${item.key}.` }}</strong>
        </div>

        <p class="text-[15px] leading-relaxed text-ink-2">{{ item.explanation }}</p>

        <div v-if="item.math" class="rounded-card border border-line bg-surface p-3.5">
          <p class="eyebrow mb-1.5">Worked solution</p>
          <p class="tabular whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{{ item.math.worked_solution }}</p>
        </div>

        <CitationBlock
          :source="item.citation.source"
          :quote="item.citation.quoted_text"
          :url="item.citation.url"
          :secondary="item.citation.secondary"
        />

        <slot name="after-reveal" />
      </div>
    </Transition>
  </article>
</template>
