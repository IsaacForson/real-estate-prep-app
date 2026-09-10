<script setup lang="ts">
import { pushToast } from "~/components/Toast.vue";
import type { OptionLetter } from "@rep/schema";
import { passItemsFrom } from "~~/lib/study/readiness";
/**
 * Mock runner (immersive). Timer, question palette with flags, finish confirmation, results.
 * Flags are a per-device convenience kept in localStorage keyed by session id.
 *
 * The palette is the navigation for a 100-question timed exam, so it does more than jump: it
 * summarises what is left and offers the two jumps people actually want under time pressure —
 * the first unanswered question and the first flagged one.
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
  // `session` above falls back to `activeSession` so the header can render before the questions
  // load — so it is truthy on arrival from Home's "Continue" banner and must NOT be what decides
  // whether to resume. Only `study.session` means "this session's items are loaded"; testing the
  // fallback skipped resume(), left `items` empty, and condemned a perfectly good exam below.
  if (!study.session.value && study.activeSession.value) await study.resume(study.activeSession.value.id);
  if (!study.session.value && !study.activeSession.value) { await navigateTo("/app/mocks", { replace: true }); return; }
  // the session's questions are not on this device (stale ids from an earlier build): drop it instead of a blank exam
  if (!study.current.value && (session.value?.itemIds.length ?? 0) > 0) {
    pushToast("That exam's questions are no longer available on this device. Start it again.", "warn");
    await study.discard();
    await navigateTo("/app/mocks", { replace: true });
    return;
  }
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

const firstUnanswered = computed(() => session.value?.itemIds.findIndex((id) => !session.value!.answers[id]) ?? -1);
const firstFlagged = computed(() => session.value?.itemIds.findIndex((id) => flags.value.has(id)) ?? -1);

const results = computed(() => (session.value?.portions ?? []).map((p) => {
  const c = p.itemIds.filter((id) => session.value!.answers[id]?.correct).length;
  const need = passItemsFrom(p.passScore, p.itemIds.length);
  // A portion with no questions has no verdict. `need` is 0 for an empty portion and `0 >= 0` is
  // true, so an empty portion reported "Pass" — which is how a 0% mock came back passing twice.
  const pass = p.itemIds.length === 0 || need == null ? null : c >= need;
  return { ...p, correct: c, need, pass, pct: p.itemIds.length ? Math.round((100 * c) / p.itemIds.length) : 0 };
}));
const overall = computed(() => { const a = Object.values(session.value?.answers ?? {}); const c = a.filter((x) => x.correct).length; return { c, n: total.value, pct: total.value ? Math.round((100 * c) / total.value) : 0 }; });

/** Answered = accent fill, unanswered = bordered surface, flagged = amber edge, current = ring. */
function cell(id: string, i: number) {
  const a = session.value?.answers[id];
  return [
    a ? "bg-accent text-accent-ink border-accent" : "bg-surface text-ink-2 border-line",
    flags.value.has(id) ? "!border-warn border-2" : "",
    i === position.value ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : "",
  ].join(" ");
}
</script>
<template>
  <div v-if="session && !finished" class="flex min-h-dvh flex-col">
    <header class="safe-pt sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-xl">
      <div class="safe-px mx-auto flex h-14 w-full max-w-3xl items-center gap-2">
        <button
          type="button"
          class="tap -ml-2.5 grid place-items-center rounded-full text-ink transition-colors hover:bg-surface-2"
          aria-label="Question palette"
          @click="palette = true"
        ><Icon name="grid" :size="20" /></button>

        <div class="min-w-0 flex-1">
          <p class="tabular text-[13.5px] leading-tight">
            <span class="font-semibold">{{ position + 1 }}</span><span class="text-muted"> / {{ total }}</span>
          </p>
          <p class="tabular text-[11.5px] leading-tight text-muted">{{ answeredCount }} answered</p>
        </div>

        <div
          v-if="remainingMs != null"
          class="tabular grid h-9 place-items-center rounded-lg px-2.5 text-[15px] font-semibold"
          :class="lowTime ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-ink'"
          role="timer"
          :aria-label="`${clock} remaining`"
        >
          <span class="inline-flex items-center gap-1.5"><Icon name="clock" :size="15" />{{ clock }}</span>
        </div>

        <button
          type="button"
          class="tap grid place-items-center rounded-full transition-colors hover:bg-surface-2"
          :class="item && flags.has(item.id) ? 'text-warn' : 'text-ink-2'"
          :aria-pressed="!!item && flags.has(item.id)"
          aria-label="Flag this question for another look"
          @click="toggleFlag"
        ><Icon :name="item && flags.has(item.id) ? 'flag-filled' : 'flag'" :size="19" /></button>
      </div>
    </header>

    <div class="safe-px mx-auto w-full max-w-3xl flex-1 py-3.5 pb-32">
      <QuestionCard v-if="item" :key="item.id" :item="item" :answered="chosen" :reveal="false" :number="position + 1" :total="total" @choose="choose" />
      <Skeleton v-else height="22rem" />
    </div>

    <div class="safe-pb fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/92 backdrop-blur-xl">
      <div class="safe-px mx-auto flex max-w-3xl gap-2 py-3">
        <AppButton variant="secondary" size="lg" icon="arrow-left" aria-label="Previous question" :disabled="position === 0" @click="go(position - 1)" />
        <AppButton v-if="!isLast" variant="primary" size="lg" block icon-right="arrow-right" @click="go(position + 1)">Next</AppButton>
        <AppButton v-else variant="primary" size="lg" block icon="check" @click="confirmFinish = true">Finish exam</AppButton>
        <AppButton v-if="!isLast" variant="ghost" size="lg" class="shrink-0" @click="confirmFinish = true">Finish</AppButton>
      </div>
    </div>

    <AppSheet :open="palette" title="Questions" @close="palette = false">
      <div class="grid gap-4">
        <div class="grid grid-cols-3 gap-2">
          <StatTile label="Answered" :value="answeredCount" />
          <StatTile label="Left" :value="total - answeredCount" :tone="total - answeredCount ? 'warn' : 'ok'" />
          <StatTile label="Flagged" :value="flags.size" :tone="flags.size ? 'warn' : 'default'" />
        </div>

        <div v-if="firstUnanswered >= 0 || firstFlagged >= 0" class="flex flex-wrap gap-2">
          <AppButton v-if="firstUnanswered >= 0" variant="secondary" size="sm" icon="arrow-right" @click="go(firstUnanswered)">
            First unanswered ({{ firstUnanswered + 1 }})
          </AppButton>
          <AppButton v-if="firstFlagged >= 0" variant="secondary" size="sm" icon="flag" @click="go(firstFlagged)">
            First flagged ({{ firstFlagged + 1 }})
          </AppButton>
        </div>

        <div class="grid grid-cols-6 gap-2 sm:grid-cols-8">
          <button
            v-for="(id, i) in session.itemIds"
            :key="id"
            type="button"
            class="tabular h-11 rounded-lg border text-[13px] font-semibold transition-colors"
            :class="cell(id, i)"
            :aria-label="`Question ${i + 1}${session.answers[id] ? ', answered' : ', unanswered'}${flags.has(id) ? ', flagged' : ''}`"
            :aria-current="i === position ? 'true' : undefined"
            @click="go(i)"
          >{{ i + 1 }}</button>
        </div>

        <div class="flex flex-wrap gap-x-3.5 gap-y-1.5 border-t border-line pt-3.5 text-[12px] text-muted">
          <span class="inline-flex items-center gap-1.5"><i class="size-3 rounded border border-accent bg-accent" />answered</span>
          <span class="inline-flex items-center gap-1.5"><i class="size-3 rounded border border-line bg-surface" />unanswered</span>
          <span class="inline-flex items-center gap-1.5"><i class="size-3 rounded border-2 border-warn" />flagged</span>
        </div>

        <AppButton variant="secondary" size="lg" block icon="check" @click="palette = false; confirmFinish = true">Submit exam</AppButton>
      </div>
    </AppSheet>

    <AppSheet
      :open="confirmFinish"
      title="Submit the exam?"
      :description="`${total - answeredCount} unanswered question${total - answeredCount === 1 ? '' : 's'} will count as wrong.`"
      @close="confirmFinish = false"
    >
      <div class="grid gap-2">
        <AppButton variant="primary" size="lg" block @click="finish()">Submit</AppButton>
        <AppButton variant="ghost" size="lg" block @click="confirmFinish = false">Keep working</AppButton>
      </div>
    </AppSheet>
  </div>

  <div v-else-if="finished" class="safe-px anim-fade-up mx-auto grid w-full max-w-3xl gap-4 py-4">
    <div class="grid justify-items-center gap-3.5 pt-4 text-center">
      <p class="eyebrow">Mock results</p>
      <ProgressRing :value="overall.pct" :size="156" :stroke="11">
        <span class="grid leading-none">
          <span class="tabular text-[36px] font-semibold tracking-[-0.032em]">{{ overall.pct }}%</span>
          <span class="tabular mt-1.5 text-[12px] text-muted">{{ overall.c }} of {{ overall.n }}</span>
        </span>
      </ProgressRing>
    </div>

    <AppCard v-for="r in results" :key="r.portion">
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-[15px] font-semibold capitalize leading-tight">{{ r.portion }} portion</p>
          <p class="tabular mt-0.5 text-[13px] text-ink-2">
            {{ r.correct }} / {{ r.itemIds.length }} correct<template v-if="r.need != null"> · {{ r.need }} needed</template>
          </p>
        </div>
        <Badge v-if="r.pass != null" :tone="r.pass ? 'ok' : 'danger'" size="md">{{ r.pass ? 'Pass' : 'Below' }}</Badge>
      </div>

      <!-- The tick is the pass mark, so a bar that stops short of it reads as "below" without the label. -->
      <div class="relative mt-3.5 h-2 overflow-hidden rounded-pill bg-surface-3">
        <span class="block h-full rounded-pill" :class="r.pass === false ? 'bg-danger' : 'bg-ok'" :style="{ width: r.pct + '%' }" />
        <span
          v-if="r.need != null && r.itemIds.length"
          class="absolute top-0 h-full w-0.5 bg-ink"
          :style="{ left: (100 * r.need) / r.itemIds.length + '%' }"
          aria-hidden="true"
        />
      </div>
    </AppCard>

    <p class="text-center text-[13px] leading-relaxed text-muted">
      Every missed question is now in Review with its citation, and your boxes are updated.
    </p>

    <div class="grid gap-2">
      <AppButton to="/app/review" variant="primary" size="lg" block>Review missed questions</AppButton>
      <AppButton to="/app/mocks" variant="secondary" size="lg" block>Back to Mocks</AppButton>
    </div>
  </div>

  <div v-else class="grid gap-3 py-10"><Skeleton height="3rem" /><Skeleton height="22rem" /></div>
</template>
