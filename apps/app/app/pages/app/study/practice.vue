<script setup lang="ts">
import type { OptionLetter } from "@rep/schema";
/**
 * Practice runner (immersive: the layout hides its chrome). Immediate feedback with explanation and
 * citation; Next / Finish in a fixed bottom bar; summary sheet at the end.
 */
useHead({ title: "Practice" });
const study = useStudy();
const session = computed(() => study.session.value ?? study.activeSession.value);
const item = computed(() => study.current.value);
const chosen = ref<OptionLetter | null>(null);
const reveal = ref(false);
const startedAt = ref(Date.now());
const quitting = ref(false);
const done = ref(false);
const busy = ref(false);

const total = computed(() => session.value?.itemIds.length ?? 0);
const position = computed(() => session.value?.position ?? 0);
const answers = computed(() => Object.values(session.value?.answers ?? {}));
const score = computed(() => ({ n: answers.value.length, c: answers.value.filter((a) => a.correct).length }));
const pct = computed(() => (total.value ? Math.round((100 * position.value) / total.value) : 0));
const isLast = computed(() => position.value + 1 >= total.value);

function restore() {
  const it = item.value, s = session.value;
  const a = it && s ? s.answers[it.id] : undefined;
  chosen.value = a?.choice ?? null; reveal.value = !!a; startedAt.value = Date.now();
}
watch(() => item.value?.id, restore, { immediate: true });

onMounted(async () => {
  if (!session.value && study.activeSession.value) await study.resume(study.activeSession.value.id);
  if (!study.session.value && !study.activeSession.value) await navigateTo("/app/study", { replace: true });
});

async function choose(letter: OptionLetter) {
  if (!item.value || reveal.value || busy.value) return;
  busy.value = true; chosen.value = letter;
  try {
    const r = await study.answer(letter);
    reveal.value = true;
  } finally { busy.value = false; }
}
async function next() {
  if (isLast.value) { await study.finish(); done.value = true; return; }
  await study.next();
}
async function quit() { await study.finish(); await navigateTo("/app/study", { replace: true }); }
</script>
<template>
  <div v-if="session && item" class="min-h-dvh flex flex-col">
    <header class="sticky top-0 z-30 bg-bg/90 backdrop-blur-md safe-pt">
      <div class="h-14 flex items-center gap-3">
        <button type="button" class="tap -ml-2 grid place-items-center rounded-full text-ink hover:bg-surface-2" aria-label="End session" @click="quitting = true"><Icon name="x" :size="22" /></button>
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline justify-between text-sm"><span class="font-semibold tabular">{{ position + 1 }} <span class="text-muted font-normal">/ {{ total }}</span></span><span class="text-muted tabular text-xs">{{ score.c }}/{{ score.n }} correct</span></div>
          <div class="h-1.5 mt-1 rounded-pill bg-surface-3 overflow-hidden"><span class="block h-full bg-accent transition-[width] duration-300" :style="{ width: pct + '%' }" /></div>
        </div>
      </div>
    </header>

    <div class="flex-1 grid gap-3 py-3 pb-28 content-start">
      <NarrationBar :item="item" :reveal="reveal" :label="`Question ${position + 1} of ${total}`" />
      <QuestionCard :key="item.id" :item="item" :answered="chosen" :reveal="reveal" @choose="choose" />
    </div>

    <div class="fixed inset-x-0 bottom-0 z-30 bg-bg/90 backdrop-blur-md border-t border-line safe-pb">
      <div class="max-w-3xl mx-auto safe-px py-3 flex gap-2">
        <AppButton variant="primary" size="lg" block :disabled="!reveal" :icon-right="isLast ? 'check' : 'arrow-right'" @click="next">{{ isLast ? 'Finish session' : 'Next question' }}</AppButton>
      </div>
    </div>

    <AppSheet :open="quitting" title="End this session?" description="Everything you've answered is saved. Unanswered questions go back into rotation." @close="quitting = false">
      <div class="grid gap-2">
        <AppButton variant="danger" size="lg" block @click="quit">End session</AppButton>
        <AppButton variant="ghost" size="lg" block @click="quitting = false">Keep going</AppButton>
      </div>
    </AppSheet>

    <AppSheet :open="done" title="Session complete" :dismissible="false">
      <div class="grid gap-4 justify-items-center text-center">
        <ProgressRing :value="score.n ? (100 * score.c) / score.n : 0" :size="132">
          <span class="grid leading-none"><span class="text-3xl font-semibold tabular">{{ score.c }}<span class="text-muted text-base font-normal">/{{ score.n }}</span></span><span class="text-[10px] uppercase tracking-wider text-muted mt-1">correct</span></span>
        </ProgressRing>
        <p class="text-sm text-ink-2">Missed questions are in <strong>Review</strong> with their citations. Your boxes and readiness are updated.</p>
        <div class="grid gap-2 w-full">
          <AppButton to="/app" variant="primary" size="lg" block>Back to Home</AppButton>
          <AppButton to="/app/review" variant="secondary" size="lg" block>Review missed</AppButton>
        </div>
      </div>
    </AppSheet>
  </div>
  <div v-else class="py-10 grid gap-3">
    <Skeleton height="3rem" />
    <Skeleton height="22rem" />
  </div>
</template>
