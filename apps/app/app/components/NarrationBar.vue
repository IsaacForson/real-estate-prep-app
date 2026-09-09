<script setup lang="ts">
import type { Item } from "@rep/schema";
/** Read-aloud controls for a question. Compact row; speed + hands-free live in a sheet. */
const props = defineProps<{ item: Item; reveal: boolean; label: string }>();
const settings = useSettings();
const n = useNarration();
const rates = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];
const more = ref(false);
async function play() { if (n.state.value === "playing") await n.toggle(); else await n.speak(props.item, { reveal: props.reveal, label: props.label }); }
watch(() => props.item.id, () => { void n.stop(); if (settings.autoAdvance) void n.speak(props.item, { reveal: false, label: props.label }); });
watch(() => props.reveal, (r) => { if (r && settings.autoAdvance) void n.speak(props.item, { reveal: true, label: props.label }); });
onUnmounted(() => { void n.stop(); });
</script>
<template>
  <div v-if="n.available.value" class="flex items-center gap-1.5 rounded-xl bg-surface border border-line px-1.5 py-1">
    <button type="button" class="tap grid place-items-center rounded-lg text-accent hover:bg-accent-soft" :aria-label="n.state.value === 'playing' ? 'Pause narration' : 'Read this question aloud'" @click="play">
      <Icon :name="n.state.value === 'playing' ? 'pause' : 'play'" :size="20" />
    </button>
    <button type="button" class="tap grid place-items-center rounded-lg text-ink-2 hover:bg-surface-2 disabled:opacity-40" aria-label="Previous part" :disabled="n.state.value === 'idle'" @click="n.previous()"><Icon name="skip-back" :size="18" /></button>
    <button type="button" class="tap grid place-items-center rounded-lg text-ink-2 hover:bg-surface-2 disabled:opacity-40" aria-label="Next part" :disabled="n.state.value === 'idle'" @click="n.next()"><Icon name="skip-forward" :size="18" /></button>
    <span class="flex-1 min-w-0 text-xs text-muted truncate">{{ n.state.value === 'idle' ? 'Read aloud' : n.trackTitle.value }}<span v-if="n.mode() === 'tts'" class="opacity-70"> · device voice</span></span>
    <button type="button" class="tap px-2 rounded-lg text-xs font-semibold tabular text-ink-2 hover:bg-surface-2" aria-label="Narration settings" @click="more = true">{{ settings.narrationRate }}×</button>
    <AppSheet :open="more" title="Narration" description="Speed and hands-free mode apply to every question." @close="more = false">
      <div class="grid gap-4">
        <div>
          <p class="text-sm font-medium mb-2">Speed</p>
          <div class="flex flex-wrap gap-2">
            <button v-for="r in rates" :key="r" type="button" class="tap px-3 rounded-xl border text-sm font-medium tabular" :class="settings.narrationRate === r ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:bg-surface-2'" @click="n.setRate(r)">{{ r }}×</button>
          </div>
        </div>
        <label class="flex items-center justify-between gap-3 min-h-11">
          <span><span class="block text-sm font-medium">Hands-free</span><span class="block text-xs text-muted">Read each question automatically, then the answer once you choose.</span></span>
          <input type="checkbox" class="size-5 accent-[var(--accent)]" :checked="settings.autoAdvance" @change="settings.set('autoAdvance', ($event.target as HTMLInputElement).checked)" />
        </label>
      </div>
    </AppSheet>
  </div>
</template>
