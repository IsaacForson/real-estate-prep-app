<script setup lang="ts">
const { load } = useContent();
const settings = useSettings();
const { data: m } = await useAsyncData("glossary", () => load());
const q = ref("");
const banks = computed(() => new Set([settings.stateBank, "national_pearsonvue", "national_psi"].filter(Boolean)));
const terms = computed(() => (m.value?.glossary ?? []).filter((t) => banks.value.has(t.bank) && (!q.value || t.term.toLowerCase().includes(q.value.toLowerCase()) || t.definition.toLowerCase().includes(q.value.toLowerCase()))));
</script>
<template>
  <div>
    <h1>Glossary</h1>
    <p class="muted">Real estate is a vocabulary exam wearing a law exam's clothes. Every definition here is grounded in a statute or reference note you can open.</p>
    <input v-model="q" placeholder="Search terms…" style="width:100%; margin-bottom:12px" />
    <div v-for="t in terms" :key="t.bank + t.term" class="card">
      <h3 style="margin:0 0 4px">{{ t.term }} <span class="pill muted" style="font-size:12px">{{ t.bank.replace('national_', '').replace('state_', '') }}</span></h3>
      <p style="margin:0 0 6px">{{ t.definition }}</p>
      <div class="cite" style="margin-top:6px"><strong>{{ t.source }}</strong><blockquote>“{{ t.quoted_text }}”</blockquote></div>
      <p class="muted" style="font-size:13px; margin:6px 0 0" v-if="t.related_terms.length">Related: {{ t.related_terms.join(', ') }}</p>
    </div>
    <p v-if="!terms.length" class="muted">No glossary terms yet for your banks — they are generated as items are approved.</p>
  </div>
</template>
