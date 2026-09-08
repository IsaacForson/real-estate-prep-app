<script setup lang="ts">
import type { Item, OptionLetter } from "@rep/schema";
import type { StudySession } from "~~/lib/study/types";
import { passItemsFrom } from "~~/lib/study/readiness";
const study = useStudy();
const router = useRouter();
const session = ref<StudySession | null>(null);
const items = ref<Item[]>([]);
const answered = ref<OptionLetter | null>(null);
const now = ref(Date.now());
const finished = ref(false);
let tick: ReturnType<typeof setInterval> | null = null;
const current = computed(() => (session.value ? items.value[session.value.position] ?? null : null));
const remainingMs = computed(() => session.value?.timeLimitMs != null ? Math.max(0, session.value.startedAt + session.value.timeLimitMs - now.value) : null);
const clock = computed(() => { const ms = remainingMs.value ?? 0; const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000); return `${m}:${String(s).padStart(2, "0")}`; });

onMounted(async () => {
  const s = await study.activeSession();
  if (!s || s.kind !== "mock") return router.replace("/study/mock");
  session.value = s; items.value = await study.getItems(s.itemIds);
  answered.value = current.value ? s.answers[current.value.id]?.choice ?? null : null;
  tick = setInterval(() => { now.value = Date.now(); if (remainingMs.value === 0 && !finished.value) finish(); }, 1000);
});
onUnmounted(() => { if (tick) clearInterval(tick); });
async function choose(letter: OptionLetter) {
  if (!session.value || !current.value) return;
  answered.value = letter;
  await study.answer(session.value, current.value, letter, 0);
}
async function go(delta: number) {
  const s = session.value!; s.position = Math.min(s.itemIds.length - 1, Math.max(0, s.position + delta));
  await study.saveSession(s); answered.value = current.value ? s.answers[current.value.id]?.choice ?? null : null;
}
const results = computed(() => (session.value?.portions ?? []).map((p) => {
  const c = p.itemIds.filter((id) => session.value!.answers[id]?.correct).length;
  const need = passItemsFrom(p.passScore, p.itemIds.length);
  return { ...p, correct: c, need, pass: need == null ? null : c >= need };
}));
async function finish() { finished.value = true; if (session.value) await study.endSession(session.value); }
</script>
<template>
  <div v-if="session && !finished">
    <div class="row" style="justify-content:space-between">
      <span class="muted">Q {{ session.position + 1 }}/{{ session.itemIds.length }} · {{ Object.keys(session.answers).length }} answered</span>
      <span class="timer" v-if="remainingMs != null">{{ clock }}</span>
      <button @click="finish">Submit exam</button>
    </div>
    <QuestionCard v-if="current" :item="current" :answered="answered" :reveal="false" @choose="choose" />
    <div class="row" style="justify-content:space-between">
      <button :disabled="session.position === 0" @click="go(-1)">← Previous</button>
      <button class="primary" :disabled="session.position + 1 >= session.itemIds.length" @click="go(1)">Next →</button>
    </div>
  </div>
  <div v-else-if="finished">
    <h1>Mock results</h1>
    <div v-for="r in results" :key="r.portion" class="card">
      <h2 style="text-transform:capitalize">{{ r.portion }}: {{ r.correct }} / {{ r.itemIds.length }} <span v-if="r.pass != null" :class="r.pass ? 'pill green' : 'pill red'">{{ r.pass ? 'pass' : 'below' }} ({{ r.need }} needed)</span></h2>
    </div>
    <p class="muted">Every missed question is now in your <NuxtLink to="/study/review">missed queue</NuxtLink> with its citation, and your boxes have been updated.</p>
    <NuxtLink class="btn primary" to="/study">Back to study</NuxtLink>
  </div>
</template>
