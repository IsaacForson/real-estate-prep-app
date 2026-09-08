<script setup lang="ts">
import type { Item, OptionLetter } from "@rep/schema";
import { OPTION_LETTERS } from "@rep/schema";
const props = defineProps<{ item: Item; answered: OptionLetter | null; reveal: boolean }>();
const emit = defineEmits<{ (e: "choose", letter: OptionLetter): void }>();
function cls(letter: OptionLetter) {
  if (!props.reveal) return props.answered === letter ? "option selected" : "option";
  if (letter === props.item.key) return "option correct";
  if (props.answered === letter) return "option wrong";
  return "option";
}
</script>
<template>
  <div class="card">
    <div class="muted" style="font-size:13px">{{ item.bank.replace('national_', '').replace('state_', '') }} · {{ item.blueprint_node }} · {{ item.cognitive_level }}</div>
    <p style="font-size:18px" v-html="item.stem.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')" />
    <button v-for="(opt, i) in item.options" :key="i" :class="cls(OPTION_LETTERS[i]!)" :disabled="reveal" @click="emit('choose', OPTION_LETTERS[i]!)">
      <strong>{{ OPTION_LETTERS[i] }}.</strong> {{ opt }}
    </button>
    <div v-if="reveal">
      <p><strong>{{ answered === item.key ? 'Correct.' : `Not quite — the answer is ${item.key}.` }}</strong> {{ item.explanation }}</p>
      <div v-if="item.math" class="notice"><strong>Worked solution:</strong> {{ item.math.worked_solution }}</div>
      <div class="cite">
        <strong>{{ item.citation.source }}</strong> <a v-if="item.citation.url" :href="item.citation.url" target="_blank" rel="noopener">open →</a>
        <blockquote>“{{ item.citation.quoted_text }}”</blockquote>
      </div>
    </div>
  </div>
</template>
