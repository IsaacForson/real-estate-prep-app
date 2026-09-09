<script setup lang="ts">
import { JURISDICTIONS, JURISDICTION_CODES } from "@rep/schema";
/**
 * Choose the home state (sheet). Shows content status honestly per state. The free tier is locked
 * to one state server-side; we surface that here instead of letting the switch fail silently.
 */
const props = defineProps<{ open: boolean; current: string | null }>();
const emit = defineEmits<{ (e: "close"): void; (e: "select", code: string): void }>();
const content = useContent();
const free = useFreeTier();
const entitlement = useEntitlement();
const q = ref("");
onMounted(() => { void content.load(); });
const list = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return JURISDICTION_CODES.filter((c) => !needle || c.toLowerCase().includes(needle) || JURISDICTIONS[c].toLowerCase().includes(needle));
});
function status(code: string) {
  const s = content.manifest.value?.status[code];
  if (!s) return { label: "planned", tone: "outline" as const };
  if (s.phase === "complete") return { label: `${s.published} questions`, tone: "ok" as const };
  if (s.verified + s.published > 0) return { label: `${s.verified + s.published} verified · in production`, tone: "warn" as const };
  return { label: "in production", tone: "outline" as const };
}
const locked = computed(() => !entitlement.isComplete.value && free.jurisdiction.value);
</script>
<template>
  <AppSheet :open="open" title="Your state" description="Both national banks are included; we route you to the one your state's vendor uses." @close="emit('close')">
    <div class="grid gap-3">
      <AppInput v-model="q" type="search" placeholder="Search states" inputmode="search" autocomplete="off" autofocus aria-label="Search states" />
      <p v-if="locked && locked !== current" class="text-xs bg-warn-soft text-ink rounded-lg px-3 py-2">The free tier covers one state and you've started in <strong>{{ locked }}</strong>. Other states unlock with Complete.</p>
      <ul class="grid gap-1 max-h-[55dvh] overflow-y-auto -mx-1 px-1">
        <li v-for="code in list" :key="code">
          <button type="button" class="w-full flex items-center gap-3 px-3 min-h-12 rounded-xl text-left hover:bg-surface-2" :class="code === current ? 'bg-accent-soft' : ''" :aria-current="code === current || undefined" @click="emit('select', code)">
            <span class="grid place-items-center size-9 rounded-lg bg-surface-2 text-xs font-semibold tabular" :class="code === current ? 'bg-accent text-accent-ink' : ''">{{ code }}</span>
            <span class="flex-1 min-w-0">
              <span class="block text-[15px] font-medium truncate">{{ JURISDICTIONS[code] }}</span>
              <span class="block text-xs text-muted truncate">{{ content.manifest.value?.states[code]?.vendor ?? '—' }}</span>
            </span>
            <Badge :tone="status(code).tone">{{ status(code).label }}</Badge>
            <Icon v-if="locked && locked !== code && !entitlement.isComplete.value" name="lock" :size="14" class="text-muted" />
          </button>
        </li>
      </ul>
      <p class="text-xs text-muted">A state marked "in production" is included in your purchase; its questions arrive as they pass verification. Nothing is padded to look finished.</p>
    </div>
  </AppSheet>
</template>
