<script setup lang="ts">
import type { Item } from "@rep/schema";
import type { Progress } from "~~/lib/study/types";
import { pushToast } from "~/components/Toast.vue";
/** Review: missed questions with their citations, and the SRS boxes (red / yellow / green). */
useHead({ title: "Review" });
const study = useStudy();
const studyState = useStudyState();
const content = useContent();
const events = useEvents();
const tab = ref<"missed" | "boxes">("missed");
const rows = ref<Array<{ p: Progress; item: Item | undefined }>>([]);
const loading = ref(true);
const open = ref<string | null>(null);
const busy = ref(false);

const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);
const banks = computed(() => {
  const v = jur.value ? content.manifest.value?.states?.[jur.value]?.vendor : null;
  return [jur.value ? `state_${jur.value}` : null, v === "psi" ? "national_psi" : v === "pearsonvue" ? "national_pearsonvue" : null].filter((b): b is string => !!b);
});
const pipelines = ref<Record<string, Awaited<ReturnType<typeof study.pipelineFor>>>>({});

async function load() {
  loading.value = true;
  try {
    const q = await study.missedQueue();
    const items = await study.getItems(q.map((p) => p.itemId));
    const byId = new Map(items.map((i) => [i.id, i]));
    rows.value = q.map((p) => ({ p, item: byId.get(p.itemId) }));
    const out: typeof pipelines.value = {};
    for (const b of banks.value) out[b] = await study.pipelineFor(b);
    pipelines.value = out;
  } finally { loading.value = false; }
}
onMounted(async () => { await content.load(); await load(); });
watch(banks, load);

const dueNow = computed(() => rows.value.filter((r) => r.p.box === "red" && !r.p.leech));
const leeches = computed(() => rows.value.filter((r) => r.p.leech));
const totals = computed(() => Object.values(pipelines.value).reduce((a, p) => ({ red: a.red + p.red, yellow: a.yellow + p.yellow, green: a.green + p.green, unseen: a.unseen + p.unseen, dueNow: a.dueNow + p.dueNow, leeches: a.leeches + p.leeches }), { red: 0, yellow: 0, green: 0, unseen: 0, dueNow: 0, leeches: 0 }));

async function reviewNow() {
  busy.value = true;
  try {
    const s = await study.startPractice({ kind: "review" });
    if (!s || !s.itemIds.length) { pushToast("Nothing due right now.", "info"); return; }
    events.track("session_start", { kind: "review" });
    await navigateTo("/app/practice");
  } finally { busy.value = false; }
}
const label = (b: string) => b.replace("national_pearsonvue", "National · Pearson VUE").replace("national_psi", "National · PSI").replace(/^state_/, "State · ");
const stem = (s: string) => s.replace(/\*\*/g, "");
</script>
<template>
  <div class="app-page grid w-full gap-4 text-ink">
    <p class="text-[13.5px] leading-relaxed text-ink-2">Missed questions and the ones due to come back. A correct review moves a card to the next box.</p>
    <AppTabs v-model="tab" :tabs="[{ value: 'missed', label: 'Missed', count: rows.length }, { value: 'boxes', label: 'Boxes' }]" aria-label="Review view" />

    <template v-if="tab === 'missed'">
      <AppCard v-if="totals.dueNow" tone="accent">
        <div class="flex items-center gap-3">
          <span class="tabular grid size-11 shrink-0 place-items-center rounded-card bg-accent text-[15px] font-semibold text-accent-ink">
            {{ totals.dueNow }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[15px] font-semibold leading-tight">due now</p>
            <p class="mt-0.5 text-[13px] leading-snug text-ink-2">
              Each correct review pushes a question to the next box.
            </p>
          </div>
          <AppButton variant="primary" size="sm" icon="play" :loading="busy" @click="reviewNow">Review</AppButton>
        </div>
      </AppCard>

      <div v-if="loading" class="grid gap-3"><Skeleton height="5.5rem" /><Skeleton height="5.5rem" /><Skeleton height="5.5rem" /></div>

      <EmptyState
        v-else-if="!rows.length"
        icon="check"
        title="Nothing missed"
        body="Wrong answers land here with their citation, so you can read the law rather than memorise the key."
      >
        <AppButton to="/app/practice" variant="secondary" size="sm">Start practising</AppButton>
      </EmptyState>

      <template v-else>
        <section v-if="leeches.length" class="grid gap-2">
          <div class="flex items-baseline justify-between gap-3 px-1">
            <h2 class="eyebrow">Leeches</h2>
            <span class="text-[11.5px] text-muted">missed 4+ times · drilled separately</span>
          </div>
          <ReviewItem
            v-for="r in leeches"
            :key="r.p.itemId"
            :p="r.p"
            :item="r.item"
            :open="open === r.p.itemId"
            @toggle="open = open === r.p.itemId ? null : r.p.itemId"
          />
        </section>

        <section class="grid gap-2">
          <h2 class="eyebrow px-1">{{ leeches.length ? 'Other missed questions' : 'Missed questions' }}</h2>
          <ReviewItem
            v-for="r in rows.filter((x) => !x.p.leech)"
            :key="r.p.itemId"
            :p="r.p"
            :item="r.item"
            :open="open === r.p.itemId"
            @toggle="open = open === r.p.itemId ? null : r.p.itemId"
          />
        </section>
      </template>
    </template>

    <template v-else>
      <div class="grid grid-cols-3 gap-2.5">
        <StatTile label="Red" :value="totals.red" tone="danger" hint="due now" />
        <StatTile label="Yellow" :value="totals.yellow" tone="warn" hint="in 2 days" />
        <StatTile label="Green" :value="totals.green" tone="ok" hint="6 → 14 → 30" />
      </div>

      <AppCard v-for="(p, b) in pipelines" :key="b" :title="label(b)" :subtitle="`${p.unseen} unseen · ${p.leeches} leech${p.leeches === 1 ? '' : 'es'}`">
        <PipelineBar :p="p" />
      </AppCard>

      <AppCard title="How boxes work" tone="paper">
        <ul class="grid gap-2.5 text-[13.5px] leading-relaxed text-ink-2">
          <li class="flex gap-2.5">
            <i class="mt-[7px] size-2.5 shrink-0 rounded-full bg-danger" />
            <span><strong class="font-semibold text-ink">Red</strong> — due now. A wrong answer sends a question here from any box.</span>
          </li>
          <li class="flex gap-2.5">
            <i class="mt-[7px] size-2.5 shrink-0 rounded-full bg-warn" />
            <span><strong class="font-semibold text-ink">Yellow</strong> — right once; comes back in 2 days.</span>
          </li>
          <li class="flex gap-2.5">
            <i class="mt-[7px] size-2.5 shrink-0 rounded-full bg-ok" />
            <span><strong class="font-semibold text-ink">Green</strong> — right twice; 6 days, then 14, then 30.</span>
          </li>
          <li class="flex gap-2.5">
            <Icon name="target" :size="14" class="mt-1 shrink-0 text-muted" />
            <span>Missed four times → <strong class="font-semibold text-ink">leech</strong>, drilled separately from Study.</span>
          </li>
        </ul>
        <NuxtLink
          to="/methodology"
          class="mt-4 inline-flex items-center gap-1 text-[13.5px] font-medium text-accent hover:underline hover:underline-offset-4"
        >Full methodology <Icon name="arrow-right" :size="15" /></NuxtLink>
      </AppCard>
    </template>
  </div>
</template>
