<script setup lang="ts">
import { JURISDICTIONS, JURISDICTION_CODES } from "@rep/schema";
const settings = useSettings();
const { load } = useContent();
const { data: manifest } = await useAsyncData("manifest", () => load());
const router = useRouter();
function choose(code: string) { settings.set("jurisdiction", code); router.push("/study"); }
function label(code: string) {
  const s = manifest.value?.status[code];
  if (!s) return "planned";
  if (s.phase === "complete") return `${s.published} questions`;
  if (s.verified + s.published > 0) return `${s.verified + s.published} verified questions · in production`;
  return s.phase;
}
</script>
<template>
  <div>
    <h1>All 50 states + DC. Every answer cites the statute. One payment.</h1>
    <p class="muted">Pick your state. Both national banks are included, and we route you to the one your state's exam vendor actually uses.</p>
    <div class="grid">
      <button v-for="code in JURISDICTION_CODES" :key="code" class="card" style="text-align:left" @click="choose(code)">
        <strong>{{ JURISDICTIONS[code] }}</strong>
        <div class="muted" style="font-size:13px">{{ manifest?.states[code]?.vendor ?? '—' }} · {{ label(code) }}</div>
        <NuxtLink :to="`/states/${code}`" class="muted" style="font-size:13px" @click.stop>exam-day brief →</NuxtLink>
      </button>
    </div>
    <p class="notice" style="margin-top:16px">Honesty note: a state marked "in production" is included in your purchase and its questions arrive as they pass verification. Nothing here is padded to look finished.</p>
  </div>
</template>
