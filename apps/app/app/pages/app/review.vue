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
  const v = jur.value ? content.manifest.value?.states[jur.value]?.vendor : null;
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
    await navigateTo("/app/study/practice");
  } finally { busy.value = false; }
}
const label = (b: string) => b.replace("national_pearsonvue", "National · Pearson VUE").replace("national_psi", "National · PSI").replace(/^state_/, "State · ");
const stem = (s: string) => s.replace(/\*\*/g, "");
</script>
<template>
  <div class="grid gap-4 anim-fade-up">
    <AppTabs v-model="tab" :tabs="[{ value: 'missed', label: 'Missed', count: rows.length }, { value: 'boxes', label: 'Boxes' }]" aria-label="Review view" />

    <template v-if="tab === 'missed'">
      <AppCard tone="accent" v-if="totals.dueNow">
        <div class="flex items-center gap-3">
          <div class="flex-1"><p class="font-semibold">{{ totals.dueNow }} due now</p><p class="text-sm text-ink-2">Clear reds before they pile up; each review pushes a question to the next box.</p></div>
          <AppButton variant="primary" size="sm" icon="play" :loading="busy" @click="reviewNow">Review</AppButton>
        </div>
      </AppCard>

      <div v-if="loading" class="grid gap-3"><Skeleton height="6rem" /><Skeleton height="6rem" /><Skeleton height="6rem" /></div>
      <EmptyState v-else-if="!rows.length" icon="check" title="Nothing missed" body="Wrong answers land here with their citation so you can read the law, not just the key." />
      <template v-else>
        <section v-if="leeches.length" class="grid gap-2">
          <h2 class="eyebrow px-1">Leeches · missed 4+ times</h2>
          <ReviewItem v-for="r in leeches" :key="r.p.itemId" :p="r.p" :item="r.item" :open="open === r.p.itemId" @toggle="open = open === r.p.itemId ? null : r.p.itemId" />
        </section>
        <section class="grid gap-2">
          <h2 class="eyebrow px-1">{{ leeches.length ? 'Other missed questions' : 'Missed questions' }}</h2>
          <ReviewItem v-for="r in rows.filter((x) => !x.p.leech)" :key="r.p.itemId" :p="r.p" :item="r.item" :open="open === r.p.itemId" @toggle="open = open === r.p.itemId ? null : r.p.itemId" />
        </section>
      </template>
    </template>

    <template v-else>
      <div class="grid grid-cols-3 gap-3">
        <StatTile label="Red · due now" :value="totals.red" tone="danger" hint="right once → yellow" />
        <StatTile label="Yellow" :value="totals.yellow" tone="warn" hint="due in 2 days" />
        <StatTile label="Green" :value="totals.green" tone="ok" hint="6 → 14 → 30 days" />
      </div>
      <AppCard v-for="(p, b) in pipelines" :key="b" :title="label(b)" :subtitle="`${p.unseen} unseen`">
        <PipelineBar :p="p" />
      </AppCard>
      <AppCard title="How boxes work" tone="paper">
        <ul class="grid gap-2 text-sm text-ink-2">
          <li class="flex gap-2"><i class="mt-1.5 size-2.5 rounded-full bg-danger shrink-0" /><span><strong class="text-ink">Red</strong> — due now. A wrong answer sends a question here from any box.</span></li>
          <li class="flex gap-2"><i class="mt-1.5 size-2.5 rounded-full bg-warn shrink-0" /><span><strong class="text-ink">Yellow</strong> — right once; comes back in 2 days.</span></li>
          <li class="flex gap-2"><i class="mt-1.5 size-2.5 rounded-full bg-ok shrink-0" /><span><strong class="text-ink">Green</strong> — right twice; 6 days, then 14, then 30.</span></li>
          <li class="flex gap-2"><Icon name="target" :size="14" class="mt-1 shrink-0 text-muted" /><span>Missed four times → <strong class="text-ink">leech</strong>, drilled separately from Study.</span></li>
        </ul>
        <NuxtLink to="/methodology" class="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent">Full methodology <Icon name="arrow-right" :size="16" /></NuxtLink>
      </AppCard>
    </template>
  </div>
</template>
