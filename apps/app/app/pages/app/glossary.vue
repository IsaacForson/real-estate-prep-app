<script setup lang="ts">
/** Glossary: terms for the learner's banks, each grounded in a cited source. */
useHead({ title: "Glossary" });
const content = useContent();
const studyState = useStudyState();
const q = ref("");
const letter = ref<string | null>(null);
const open = ref<string | null>(null);
onMounted(() => { void content.load(); });
const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);
const banks = computed(() => new Set([jur.value ? `state_${jur.value}` : null, "national_pearsonvue", "national_psi"].filter(Boolean)));
const all = computed(() => (content.manifest.value?.glossary ?? []).filter((t) => banks.value.has(t.bank)).sort((a, b) => a.term.localeCompare(b.term)));
const terms = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return all.value.filter((t) => (!needle || t.term.toLowerCase().includes(needle) || t.definition.toLowerCase().includes(needle)) && (!letter.value || t.term[0]?.toUpperCase() === letter.value));
});
const letters = computed(() => [...new Set(all.value.map((t) => t.term[0]?.toUpperCase() ?? "#"))].sort());
const bankLabel = (b: string) => b.replace("national_pearsonvue", "Pearson VUE").replace("national_psi", "PSI").replace(/^state_/, "");
const chip = (on: boolean) => (on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink-2 hover:bg-surface-2");
</script>
<template>
  <div class="grid w-full gap-4">
    <p class="text-[13.5px] leading-relaxed text-ink-2">
      Real estate is a vocabulary exam wearing a law exam's clothes. Every definition here is grounded
      in a statute or reference you can open.
    </p>

    <div class="grid gap-2.5">
      <AppInput
        v-model="q"
        type="search"
        placeholder="Search terms and definitions"
        inputmode="search"
        autocomplete="off"
        aria-label="Search glossary"
      />

      <div v-if="letters.length > 4" class="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Filter by letter">
        <button
          type="button"
          role="tab"
          class="tabular grid h-9 shrink-0 place-items-center rounded-lg border px-3 text-[13px] font-semibold transition-colors"
          :class="chip(!letter)"
          :aria-selected="!letter"
          @click="letter = null"
        >All</button>
        <button
          v-for="l in letters"
          :key="l"
          type="button"
          role="tab"
          class="grid size-9 shrink-0 place-items-center rounded-lg border text-[13px] font-semibold transition-colors"
          :class="chip(letter === l)"
          :aria-selected="letter === l"
          @click="letter = letter === l ? null : l"
        >{{ l }}</button>
      </div>

      <p class="tabular px-1 text-[11.5px] text-muted" aria-live="polite">{{ terms.length }} of {{ all.length }} terms</p>
    </div>

    <ul v-if="terms.length" class="grid gap-2">
      <li v-for="t in terms" :key="t.bank + t.term">
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

    <EmptyState
      v-else
      icon="list"
      :title="all.length ? 'No matching terms' : 'No glossary terms yet'"
      :body="all.length ? 'Try a different spelling, or clear the letter filter.' : 'Terms are generated as items for your banks are approved.'"
    >
      <AppButton v-if="all.length && (q || letter)" variant="secondary" size="sm" @click="q = ''; letter = null">Clear filters</AppButton>
    </EmptyState>
  </div>
</template>
