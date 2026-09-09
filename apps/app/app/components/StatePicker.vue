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
  if (s.verified + s.published > 0) return { label: `${s.verified + s.published} verified`, tone: "warn" as const };
  return { label: "in production", tone: "outline" as const };
}
const locked = computed(() => !entitlement.isComplete.value && free.jurisdiction.value);
</script>
<template>
  <AppSheet
    :open="open"
    title="Your state"
    description="Both national banks are included; we route you to the one your state's vendor uses."
    @close="emit('close')"
  >
    <div class="grid gap-3">
      <AppInput v-model="q" type="search" placeholder="Search states" inputmode="search" autocomplete="off" autofocus aria-label="Search states" />

      <p v-if="locked && locked !== current" class="flex items-start gap-2 rounded-card border border-warn/25 bg-warn-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">
        <Icon name="info" :size="15" class="mt-px shrink-0 text-warn" />
        <span>The free tier covers one state and you've started in <strong>{{ locked }}</strong>. Other states unlock with Complete.</span>
      </p>

      <ul class="-mx-1 grid max-h-[55dvh] gap-0.5 overflow-y-auto px-1">
        <li v-for="code in list" :key="code">
          <button
            type="button"
            class="flex min-h-12 w-full items-center gap-3 rounded-card px-2.5 text-left transition-colors hover:bg-surface-2"
            :class="code === current ? 'bg-accent-soft' : ''"
            :aria-current="code === current || undefined"
            @click="emit('select', code)"
          >
            <span
              class="tabular grid size-9 shrink-0 place-items-center rounded-lg text-[12px] font-semibold"
              :class="code === current ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-2'"
            >{{ code }}</span>

            <span class="min-w-0 flex-1">
              <span class="block truncate text-[15px] font-medium">{{ JURISDICTIONS[code] }}</span>
              <span class="block truncate text-[12px] text-muted">{{ content.manifest.value?.states[code]?.vendor ?? '—' }}</span>
            </span>

            <Badge :tone="status(code).tone">{{ status(code).label }}</Badge>
            <Icon v-if="locked && locked !== code && !entitlement.isComplete.value" name="lock" :size="14" class="shrink-0 text-muted" />
          </button>
        </li>
      </ul>

      <p class="border-t border-line pt-3 text-[12px] leading-relaxed text-muted">
        A state marked "in production" is included in your purchase; its questions arrive as they pass
        verification. Nothing is padded to look finished.
      </p>
    </div>
  </AppSheet>
</template>
