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
</script>
<template>
  <div class="grid gap-4 anim-fade-up">
    <p class="text-sm text-muted">Real estate is a vocabulary exam wearing a law exam's clothes. Every definition here is grounded in a statute or reference you can open.</p>
    <AppInput v-model="q" type="search" placeholder="Search terms and definitions" inputmode="search" autocomplete="off" aria-label="Search glossary" />
    <div v-if="letters.length > 4" class="flex gap-1 overflow-x-auto no-scrollbar -mx-4 px-4" role="tablist" aria-label="Filter by letter">
      <button type="button" role="tab" class="tap px-3 rounded-lg text-sm font-medium shrink-0" :class="!letter ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-2'" :aria-selected="!letter" @click="letter = null">All</button>
      <button v-for="l in letters" :key="l" type="button" role="tab" class="tap px-3 rounded-lg text-sm font-medium shrink-0" :class="letter === l ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-2'" :aria-selected="letter === l" @click="letter = letter === l ? null : l">{{ l }}</button>
    </div>
    <p class="text-xs text-muted px-1 tabular">{{ terms.length }} of {{ all.length }} terms</p>
    <ul v-if="terms.length" class="grid gap-2">
      <li v-for="t in terms" :key="t.bank + t.term">
        <article class="rounded-card bg-surface border border-line overflow-hidden">
          <button type="button" class="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-surface-2" :aria-expanded="open === t.bank + t.term" @click="open = open === t.bank + t.term ? null : t.bank + t.term">
            <span class="flex-1 min-w-0">
              <span class="flex items-center gap-2"><span class="font-semibold text-[15px]">{{ t.term }}</span><Badge tone="outline">{{ bankLabel(t.bank) }}</Badge></span>
              <span class="block text-sm text-ink-2 mt-0.5" :class="open === t.bank + t.term ? '' : 'line-clamp-2'">{{ t.definition }}</span>
            </span>
            <Icon name="chevron-down" :size="18" class="text-muted shrink-0 transition-transform" :class="open === t.bank + t.term ? 'rotate-180' : ''" />
          </button>
          <div v-if="open === t.bank + t.term" class="border-t border-line bg-paper px-4 py-4 grid gap-3">
            <CitationBlock :source="t.source" :quote="t.quoted_text" />
            <p v-if="t.related_terms.length" class="text-xs text-muted">Related: <button v-for="(r, i) in t.related_terms" :key="r" type="button" class="text-accent underline underline-offset-2" @click="q = r; letter = null">{{ r }}<template v-if="i < t.related_terms.length - 1">, </template></button></p>
          </div>
        </article>
      </li>
    </ul>
    <EmptyState v-else icon="list" :title="all.length ? 'No matching terms' : 'No glossary terms yet'" :body="all.length ? 'Try a different spelling or clear the letter filter.' : 'Terms are generated as items for your banks are approved.'" />
  </div>
</template>
