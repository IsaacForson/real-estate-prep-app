<script setup lang="ts">
import type { Item, OptionLetter } from "@rep/schema";
import type { StudySession } from "~~/lib/study/types";
const study = useStudy();
const router = useRouter();
const session = ref<StudySession | null>(null);
const items = ref<Item[]>([]);
const answered = ref<OptionLetter | null>(null);
const reveal = ref(false);
const startedAt = ref(Date.now());
const current = computed(() => (session.value ? items.value[session.value.position] ?? null : null));

onMounted(async () => {
  const s = await study.activeSession();
  if (!s) return router.replace("/study");
  session.value = s;
  items.value = await study.getItems(s.itemIds);
  restoreState();
});
function restoreState() {
  const s = session.value!, it = current.value;
  const a = it ? s.answers[it.id] : undefined;
  answered.value = a?.choice ?? null; reveal.value = !!a; startedAt.value = Date.now();
}
async function choose(letter: OptionLetter) {
  if (!session.value || !current.value || reveal.value) return;
  answered.value = letter;
  await study.answer(session.value, current.value, letter, Date.now() - startedAt.value);
  reveal.value = true;
}
async function next() {
  const s = session.value!;
  if (s.position + 1 >= s.itemIds.length) { await study.endSession(s); return router.replace("/study"); }
  s.position++; await study.saveSession(s); restoreState();
}
async function quit() { if (session.value) { await study.endSession(session.value); } router.replace("/study"); }
const score = computed(() => { const a = Object.values(session.value?.answers ?? {}); return { n: a.length, c: a.filter((x) => x.correct).length }; });
</script>
<template>
  <div v-if="session">
    <div class="row" style="justify-content:space-between">
      <span class="muted">Question {{ session.position + 1 }} of {{ session.itemIds.length }} · {{ score.c }}/{{ score.n }} correct</span>
      <button @click="quit">End session</button>
    </div>
    <NarrationBar v-if="current && session" :item="current" :reveal="reveal" :label="`Question ${session.position + 1} of ${session.itemIds.length}`" />
    <QuestionCard v-if="current" :item="current" :answered="answered" :reveal="reveal" @choose="choose" />
    <p v-else class="muted">Loading question…</p>
    <div class="row" style="justify-content:flex-end">
      <button class="primary" :disabled="!reveal" @click="next">{{ session.position + 1 >= session.itemIds.length ? 'Finish' : 'Next →' }}</button>
    </div>
  </div>
</template>
