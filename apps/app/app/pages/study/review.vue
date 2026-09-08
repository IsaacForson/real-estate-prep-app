<script setup lang="ts">
import type { Item } from "@rep/schema";
import type { Progress } from "~~/lib/study/types";
const study = useStudy();
const rows = ref<Array<{ p: Progress; item: Item | undefined }>>([]);
onMounted(async () => {
  const q = await study.missedQueue();
  const items = await study.getItems(q.map((p) => p.itemId));
  const byId = new Map(items.map((i) => [i.id, i]));
  rows.value = q.map((p) => ({ p, item: byId.get(p.itemId) }));
});
</script>
<template>
  <div>
    <h1>Missed questions</h1>
    <p class="muted">Every wrong answer lands here with its citation. Reds are due now; leeches (missed 4+ times) get their own drill.</p>
    <div v-for="{ p, item } in rows" :key="p.itemId" class="card">
      <div class="row" style="justify-content:space-between"><span class="pill" :class="p.box">{{ p.box }}<template v-if="p.leech"> · leech</template></span><span class="muted">missed {{ p.misses }}× · {{ p.correct }}/{{ p.attempts }} correct</span></div>
      <template v-if="item">
        <p v-html="item.stem.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')" />
        <p><strong>{{ item.key }}.</strong> {{ item.options[['A','B','C','D'].indexOf(item.key)] }} — <span class="muted">{{ item.explanation }}</span></p>
        <div class="cite"><strong>{{ item.citation.source }}</strong><blockquote>“{{ item.citation.quoted_text }}”</blockquote></div>
      </template>
    </div>
    <p v-if="!rows.length" class="muted">Nothing missed yet.</p>
  </div>
</template>
