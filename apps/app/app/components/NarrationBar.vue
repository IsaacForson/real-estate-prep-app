<script setup lang="ts">
import type { Item } from "@rep/schema";
const props = defineProps<{ item: Item; reveal: boolean; label: string }>();
const settings = useSettings();
const n = useNarration();
const rates = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];
async function play() { if (n.state.value === "playing") await n.toggle(); else await n.speak(props.item, { reveal: props.reveal, label: props.label }); }
watch(() => props.item.id, () => { void n.stop(); if (settings.autoAdvance) void n.speak(props.item, { reveal: false, label: props.label }); });
watch(() => props.reveal, (r) => { if (r && settings.autoAdvance) void n.speak(props.item, { reveal: true, label: props.label }); });
onUnmounted(() => { void n.stop(); });
</script>
<template>
  <div class="row" style="justify-content:space-between; margin: 4px 0 10px" v-if="n.available.value">
    <div class="row">
      <button @click="play" :title="n.state.value === 'playing' ? 'Pause' : 'Read aloud'">{{ n.state.value === 'playing' ? '⏸' : '▶︎' }} {{ n.state.value === 'playing' ? 'Pause' : 'Read aloud' }}</button>
      <button @click="n.previous()" :disabled="n.state.value === 'idle'">⏮</button>
      <button @click="n.next()" :disabled="n.state.value === 'idle'">⏭</button>
      <span class="muted" style="font-size:13px">{{ n.trackTitle.value }}</span>
    </div>
    <div class="row">
      <label class="muted" style="font-size:13px">Speed
        <select :value="settings.narrationRate" @change="n.setRate(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="r in rates" :key="r" :value="r">{{ r }}×</option>
        </select>
      </label>
      <label class="muted" style="font-size:13px"><input type="checkbox" :checked="settings.autoAdvance" @change="settings.set('autoAdvance', ($event.target as HTMLInputElement).checked)" /> hands-free</label>
      <span class="pill" v-if="n.mode() === 'tts'" title="Pre-generated audio not yet available for this item; using device speech">device voice</span>
    </div>
  </div>
</template>
