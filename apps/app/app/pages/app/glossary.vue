<script setup lang="ts">
/** Glossary: terms for the learner's banks, each grounded in a cited source. */
import type { GlossaryTerm } from "~/composables/useContent";
useHead({ title: "Glossary" });
const content = useContent();
const studyState = useStudyState();
const PAGE = 200;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const q = ref("");
const letter = ref<string | null>(null);
const open = ref<string | null>(null);
const page = ref(0);
const rows = ref<GlossaryTerm[]>([]);
const total = ref(0);
const loading = ref(true);
const filterEl = ref<HTMLElement | null>(null);
const resultsEl = ref<HTMLElement | null>(null);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE)));
const fromN = computed(() => (total.value ? page.value * PAGE + 1 : 0));
const toN = computed(() => Math.min(total.value, (page.value + 1) * PAGE));

/** Put the first term of this page just under the sticky filters. */
function revealFirst() {
  if (!import.meta.client) return;
  nextTick(() => {
    requestAnimationFrame(() => {
      const list = resultsEl.value;
      if (!list) return;
      const barBottom = filterEl.value?.getBoundingClientRect().bottom ?? 0;
      const delta = list.getBoundingClientRect().top - barBottom - 12;
      if (Math.abs(delta) < 2) return;
      window.scrollBy({ top: delta, behavior: "auto" });
    });
  });
}
const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);
const banks = computed(() => [jur.value ? `state_${jur.value}` : null, "national_pearsonvue", "national_psi"].filter((b): b is string => !!b));

/** Quote a value for a PostgREST `or` filter so commas and wildcards stay inside the pattern. */
function ilikeOr(needle: string) {
  const v = `"%${needle.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/"/g, '""')}%"`;
  return `term.ilike.${v},definition.ilike.${v}`;
}

function normalize(t: GlossaryTerm): GlossaryTerm {
  return { ...t, related_terms: t.related_terms ?? [], items: t.items ?? [] };
}

let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function fetchPage(scroll: boolean) {
  const mine = ++seq;
  loading.value = true;
  const needle = q.value.trim();
  const sb = useNuxtApp().$supabase as import("@supabase/supabase-js").SupabaseClient | null;
  if (sb) {
    let query = sb.from("glossary").select("bank, term, definition, source, quoted_text, related_terms, items", { count: "exact" }).in("bank", banks.value).order("term").order("bank");
    if (letter.value) query = query.ilike("term", `${letter.value}%`);
    if (needle) query = query.or(ilikeOr(needle));
    const from = page.value * PAGE;
    const { data, count, error } = await query.range(from, from + PAGE - 1);
    if (mine !== seq) return;
    if (!error && ((count ?? 0) > 0 || needle || letter.value)) {
      rows.value = ((data ?? []) as GlossaryTerm[]).map(normalize);
      total.value = count ?? rows.value.length;
      loading.value = false;
      if (scroll) revealFirst();
      return;
    }
  }
  await content.load();
  if (mine !== seq) return;
  const low = needle.toLowerCase();
  const full = (content.manifest.value?.glossary ?? [])
    .filter((t) => banks.value.includes(t.bank) && (!low || t.term.toLowerCase().includes(low) || t.definition.toLowerCase().includes(low)) && (!letter.value || t.term[0]?.toUpperCase() === letter.value))
    .sort((a, b) => a.term.localeCompare(b.term) || a.bank.localeCompare(b.bank));
  total.value = full.length;
  rows.value = full.slice(page.value * PAGE, (page.value + 1) * PAGE).map(normalize);
  loading.value = false;
  if (scroll) revealFirst();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (page.value !== 0) page.value = 0;
    else void fetchPage(true);
  }, q.value.trim() ? 200 : 0);
}

watch([q, letter, jur], schedule);
watch(page, () => { void fetchPage(true); });
onMounted(() => { void fetchPage(false); });
const bankLabel = (b: string) => b.replace("national_pearsonvue", "Pearson VUE").replace("national_psi", "PSI").replace(/^state_/, "");
const chip = (on: boolean) => (on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink-2 hover:bg-surface-2");
</script>
<template>
  <div class="grid w-full gap-4">
    <p class="text-[13.5px] leading-relaxed text-ink-2">
      Real estate is a vocabulary exam wearing a law exam's clothes. Every definition here is grounded
      in a statute or reference you can open.
    </p>

    <div
      ref="filterEl"
      class="sticky top-[var(--app-sticky-top,calc(env(safe-area-inset-top)+3.5rem))] z-20 -mx-4 grid gap-2.5 border-b border-line bg-bg px-4 pt-2 pb-3"
    >
      <AppInput
        v-model="q"
        type="search"
        placeholder="Search terms and definitions"
        inputmode="search"
        autocomplete="off"
        aria-label="Search glossary"
      />

      <div class="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Filter by letter">
        <button
          type="button"
          role="tab"
          class="tabular grid h-9 shrink-0 place-items-center rounded-lg border px-3 text-[13px] font-semibold transition-colors"
          :class="chip(!letter)"
          :aria-selected="!letter"
          @click="letter = null"
        >All</button>
        <button
          v-for="l in LETTERS"
          :key="l"
          type="button"
          role="tab"
          class="grid size-9 shrink-0 place-items-center rounded-lg border text-[13px] font-semibold transition-colors"
          :class="chip(letter === l)"
          :aria-selected="letter === l"
          @click="letter = letter === l ? null : l"
        >{{ l }}</button>
      </div>

      <p class="tabular px-1 text-[11.5px] text-muted" aria-live="polite">{{ loading && !rows.length ? "Loading terms…" : `${fromN}–${toN} of ${total} terms` }}</p>
    </div>

    <div ref="resultsEl" class="[overflow-anchor:none]">
    <div v-if="loading && !rows.length" class="grid gap-2" aria-hidden="true">
      <Skeleton v-for="i in 6" :key="i" height="4.5rem" />
    </div>
    <ul v-else-if="rows.length" class="grid gap-2">
      <li v-for="t in rows" :key="t.bank + t.term">
        <article class="overflow-hidden rounded-card border border-line bg-surface">
          <button
            type="button"
            class="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
            :aria-expanded="open === t.bank + t.term"
            @click="open = open === t.bank + t.term ? null : t.bank + t.term"
          >
            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-center gap-2">
                <span class="text-[15px] font-semibold tracking-[-0.012em]">{{ t.term }}</span>
                <Badge tone="outline">{{ bankLabel(t.bank) }}</Badge>
              </span>
              <span class="mt-1 block text-[13.5px] leading-relaxed text-ink-2" :class="open === t.bank + t.term ? '' : 'line-clamp-2'">{{ t.definition }}</span>
            </span>
            <Icon
              name="chevron-down"
              :size="18"
              class="mt-0.5 shrink-0 text-muted transition-transform duration-200 ease-standard"
              :class="open === t.bank + t.term ? 'rotate-180' : ''"
            />
          </button>

          <div v-if="open === t.bank + t.term" class="grid gap-3 border-t border-line bg-paper px-4 py-4">
            <CitationBlock :source="t.source" :quote="t.quoted_text" />
            <p v-if="t.related_terms.length" class="text-[12px] text-muted">
              Related:
              <button
                v-for="(r, i) in t.related_terms"
                :key="r"
                type="button"
                class="font-medium text-accent underline underline-offset-2"
                @click="q = r; letter = null"
              >{{ r }}<template v-if="i < t.related_terms.length - 1">, </template></button>
            </p>
          </div>
        </article>
      </li>
    </ul>

    <nav v-if="pageCount > 1" class="flex items-center justify-between gap-3 pt-1" aria-label="Glossary pages">
      <button type="button" class="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-semibold disabled:opacity-40" :disabled="page === 0 || loading" @click="page--">Previous</button>
      <span class="tabular text-[12px] text-muted">Page {{ page + 1 }} of {{ pageCount }}</span>
      <button type="button" class="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-semibold disabled:opacity-40" :disabled="page >= pageCount - 1 || loading" @click="page++">Next</button>
    </nav>

    <EmptyState
      v-if="!loading && !rows.length"
      icon="list"
      :title="q || letter ? 'No matching terms' : 'No glossary terms yet'"
      :body="q || letter ? 'Try a different spelling, or clear the letter filter.' : 'Terms are generated as items for your banks are approved.'"
    >
      <AppButton v-if="q || letter" variant="secondary" size="sm" @click="q = ''; letter = null">Clear filters</AppButton>
    </EmptyState>
    </div>
  </div>
</template>
