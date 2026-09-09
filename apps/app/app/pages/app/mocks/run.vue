<script setup lang="ts">
import type { OptionLetter } from "@rep/schema";
import { passItemsFrom } from "~~/lib/study/readiness";
/**
 * Mock runner (immersive). Timer, question palette with flags, finish confirmation, results.
 * Flags are a per-device convenience kept in localStorage keyed by session id.
 */
useHead({ title: "Mock" });
const study = useStudy();
const session = computed(() => study.session.value ?? study.activeSession.value);
const item = computed(() => study.current.value);
const chosen = ref<OptionLetter | null>(null);
const now = ref(Date.now());
const palette = ref(false);
const confirmFinish = ref(false);
const finished = ref(false);
const flags = ref<Set<string>>(new Set());
let tick: ReturnType<typeof setInterval> | null = null;

const total = computed(() => session.value?.itemIds.length ?? 0);
const position = computed(() => session.value?.position ?? 0);
const answeredCount = computed(() => Object.keys(session.value?.answers ?? {}).length);
const remainingMs = computed(() => session.value?.timeLimitMs != null ? Math.max(0, session.value.startedAt + session.value.timeLimitMs - now.value) : null);
const clock = computed(() => { const ms = remainingMs.value ?? 0; const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000); return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s).padStart(2, "0")}`; });
const lowTime = computed(() => remainingMs.value != null && remainingMs.value < 5 * 60_000);
const isLast = computed(() => position.value + 1 >= total.value);
const flagKey = computed(() => (session.value ? `rep-flags:${session.value.id}` : null));

function loadFlags() { try { flags.value = new Set(JSON.parse(localStorage.getItem(flagKey.value ?? "") ?? "[]")); } catch { flags.value = new Set(); } }
function saveFlags() { try { if (flagKey.value) localStorage.setItem(flagKey.value, JSON.stringify([...flags.value])); } catch {} }
function toggleFlag() { if (!item.value) return; const s = new Set(flags.value); s.has(item.value.id) ? s.delete(item.value.id) : s.add(item.value.id); flags.value = s; saveFlags(); }

watch(() => item.value?.id, () => { chosen.value = item.value && session.value ? session.value.answers[item.value.id]?.choice ?? null : null; }, { immediate: true });
watch(flagKey, loadFlags, { immediate: true });

onMounted(async () => {
  if (!session.value && study.activeSession.value) await study.resume(study.activeSession.value.id);
  if (!study.session.value && !study.activeSession.value) { await navigateTo("/app/mocks", { replace: true }); return; }
  tick = setInterval(() => { now.value = Date.now(); if (remainingMs.value === 0 && !finished.value) void finish(true); }, 1000);
});
onUnmounted(() => { if (tick) clearInterval(tick); });

async function choose(letter: OptionLetter) { if (!item.value) return; chosen.value = letter; await study.answer(letter); }
async function go(index: number) { palette.value = false; await study.goTo(index); }
async function finish(auto = false) {
  confirmFinish.value = false; finished.value = true;
  if (tick) { clearInterval(tick); tick = null; }
  await study.finish();
  try { if (flagKey.value) localStorage.removeItem(flagKey.value); } catch {}
}
const results = computed(() => (session.value?.portions ?? []).map((p) => {
  const c = p.itemIds.filter((id) => session.value!.answers[id]?.correct).length;
  const need = passItemsFrom(p.passScore, p.itemIds.length);
  return { ...p, correct: c, need, pass: need == null ? null : c >= need, pct: p.itemIds.length ? Math.round((100 * c) / p.itemIds.length) : 0 };
}));
const overall = computed(() => { const a = Object.values(session.value?.answers ?? {}); const c = a.filter((x) => x.correct).length; return { c, n: total.value, pct: total.value ? Math.round((100 * c) / total.value) : 0 }; });
function cell(id: string, i: number) {
  const a = session.value?.answers[id];
  return [flags.value.has(id) ? "ring-2 ring-warn" : "", i === position.value ? "outline outline-2 outline-accent outline-offset-1" : "", a ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2"].join(" ");
}
</script>
<template>
  <div v-if="session && !finished" class="min-h-dvh flex flex-col">
    <header class="sticky top-0 z-30 bg-bg/90 backdrop-blur-md safe-pt">
      <div class="h-14 flex items-center gap-2">
        <button type="button" class="tap -ml-2 grid place-items-center rounded-full text-ink hover:bg-surface-2" aria-label="Question palette" @click="palette = true"><Icon name="list" :size="22" /></button>
        <div class="flex-1 min-w-0 text-sm"><span class="font-semibold tabular">{{ position + 1 }}</span><span class="text-muted"> / {{ total }}</span><span class="text-muted text-xs"> · {{ answeredCount }} answered</span></div>
        <div v-if="remainingMs != null" class="px-2.5 h-9 grid place-items-center rounded-lg tabular font-semibold text-[15px]" :class="lowTime ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-ink'" role="timer" :aria-label="`${clock} remaining`"><span class="inline-flex items-center gap-1.5"><Icon name="clock" :size="16" />{{ clock }}</span></div>
        <button type="button" class="tap grid place-items-center rounded-full hover:bg-surface-2" :class="item && flags.has(item.id) ? 'text-warn' : 'text-ink'" :aria-pressed="!!item && flags.has(item.id)" aria-label="Flag this question" @click="toggleFlag"><Icon :name="item && flags.has(item.id) ? 'flag-filled' : 'flag'" :size="20" /></button>
      </div>
    </header>

    <div class="flex-1 py-3 pb-28">
      <QuestionCard v-if="item" :key="item.id" :item="item" :answered="chosen" :reveal="false" :number="position + 1" :total="total" @choose="choose" />
      <Skeleton v-else height="22rem" />
    </div>

    <div class="fixed inset-x-0 bottom-0 z-30 bg-bg/90 backdrop-blur-md border-t border-line safe-pb">
      <div class="max-w-3xl mx-auto safe-px py-3 flex gap-2">
        <AppButton variant="secondary" size="lg" icon="arrow-left" aria-label="Previous question" :disabled="position === 0" @click="go(position - 1)" />
        <AppButton v-if="!isLast" variant="primary" size="lg" block icon-right="arrow-right" @click="go(position + 1)">Next</AppButton>
        <AppButton v-else variant="primary" size="lg" block icon="check" @click="confirmFinish = true">Finish exam</AppButton>
        <AppButton v-if="!isLast" variant="ghost" size="lg" @click="confirmFinish = true">Finish</AppButton>
      </div>
    </div>

    <AppSheet :open="palette" title="Questions" :description="`${answeredCount} answered · ${total - answeredCount} left · ${flags.size} flagged`" @close="palette = false">
      <div class="grid grid-cols-6 sm:grid-cols-8 gap-2">
        <button v-for="(id, i) in session.itemIds" :key="id" type="button" class="h-11 rounded-lg text-sm font-semibold tabular transition-colors" :class="cell(id, i)" :aria-label="`Question ${i + 1}${session.answers[id] ? ', answered' : ''}${flags.has(id) ? ', flagged' : ''}`" @click="go(i)">{{ i + 1 }}</button>
      </div>
      <div class="mt-4 flex flex-wrap gap-3 text-xs text-muted"><span class="inline-flex items-center gap-1.5"><i class="size-3 rounded bg-accent" />answered</span><span class="inline-flex items-center gap-1.5"><i class="size-3 rounded bg-surface-2 border border-line" />unanswered</span><span class="inline-flex items-center gap-1.5"><i class="size-3 rounded ring-2 ring-warn" />flagged</span></div>
    </AppSheet>

    <AppSheet :open="confirmFinish" title="Submit the exam?" :description="`${total - answeredCount} unanswered question${total - answeredCount === 1 ? '' : 's'} will count as wrong.`" @close="confirmFinish = false">
      <div class="grid gap-2">
        <AppButton variant="primary" size="lg" block @click="finish()">Submit</AppButton>
        <AppButton variant="ghost" size="lg" block @click="confirmFinish = false">Keep working</AppButton>
      </div>
    </AppSheet>
  </div>

  <div v-else-if="finished" class="grid gap-4 py-4 anim-fade-up">
    <div class="text-center grid gap-3 justify-items-center pt-4">
      <p class="eyebrow">Mock results</p>
      <ProgressRing :value="overall.pct" :size="160" :stroke="12">
        <span class="grid leading-none"><span class="text-4xl font-semibold tabular tracking-tight">{{ overall.pct }}%</span><span class="text-xs text-muted mt-1 tabular">{{ overall.c }} of {{ overall.n }}</span></span>
      </ProgressRing>
    </div>
    <AppCard v-for="r in results" :key="r.portion">
      <div class="flex items-center gap-3">
        <div class="flex-1 min-w-0"><p class="font-semibold capitalize">{{ r.portion }} portion</p><p class="text-sm text-ink-2 tabular">{{ r.correct }} / {{ r.itemIds.length }} correct<template v-if="r.need != null"> · {{ r.need }} needed</template></p></div>
        <Badge v-if="r.pass != null" :tone="r.pass ? 'ok' : 'danger'" size="md">{{ r.pass ? 'Pass' : 'Below' }}</Badge>
      </div>
      <div class="mt-3 h-2 rounded-pill bg-surface-3 overflow-hidden relative">
        <span class="block h-full" :class="r.pass === false ? 'bg-danger' : 'bg-ok'" :style="{ width: r.pct + '%' }" />
        <span v-if="r.need != null && r.itemIds.length" class="absolute top-0 h-full w-0.5 bg-ink" :style="{ left: (100 * r.need) / r.itemIds.length + '%' }" aria-hidden="true" />
      </div>
    </AppCard>
    <p class="text-sm text-muted text-center">Every missed question is now in Review with its citation, and your boxes are updated.</p>
    <div class="grid gap-2">
      <AppButton to="/app/review" variant="primary" size="lg" block>Review missed questions</AppButton>
      <AppButton to="/app/mocks" variant="secondary" size="lg" block>Back to Mocks</AppButton>
    </div>
  </div>
  <div v-else class="py-10 grid gap-3"><Skeleton height="3rem" /><Skeleton height="22rem" /></div>
</template>
