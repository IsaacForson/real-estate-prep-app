<script setup lang="ts">
import { JURISDICTIONS, JURISDICTION_CODES } from "@rep/schema";
/**
 * Choose the home state (sheet).
 *
 * Free accounts get one state, chosen once. The lock icons used to be decoration — tapping a
 * locked row still switched. Now a locked row does nothing, and the first pick has to be
 * confirmed so nobody lands in the wrong state by accident.
 */
const props = defineProps<{ open: boolean; current: string | null }>();
const emit = defineEmits<{ (e: "close"): void; (e: "select", code: string): void }>();
const content = useContent();
const free = useFreeTier();
const entitlement = useEntitlement();
const q = ref("");
const pending = ref<string | null>(null);
onMounted(() => { void content.load(); });
watch(() => props.open, (o) => { if (!o) { pending.value = null; q.value = ""; } });

const lockedTo = computed(() => {
  if (entitlement.isComplete.value) return null;
  return entitlement.profile.value?.home_jurisdiction ?? free.jurisdiction.value ?? null;
});
const needsConfirm = computed(() => !entitlement.isComplete.value && !lockedTo.value);

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

function pick(code: string) {
  if (lockedTo.value && lockedTo.value !== code) return;
  if (needsConfirm.value && pending.value !== code) { pending.value = code; return; }
  emit("select", code);
}
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

      <div v-if="pending" class="rounded-card border border-warn/35 bg-warn-soft p-4">
        <p class="m-0 text-[14px] font-extrabold leading-snug">
          Lock in {{ JURISDICTIONS[pending as keyof typeof JURISDICTIONS] ?? pending }}?
        </p>
        <p class="m-0 mt-1.5 text-[13px] leading-relaxed text-ink-2">
          The free tier is one state only. After you confirm, you cannot switch — Complete unlocks
          all 51 jurisdictions.
        </p>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <AppButton variant="ghost" size="sm" @click="pending = null">Pick another</AppButton>
          <AppButton variant="primary" size="sm" @click="pick(pending!)">Confirm {{ pending }}</AppButton>
        </div>
      </div>

      <p v-else-if="lockedTo" class="flex items-start gap-2 rounded-card border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
        <Icon name="lock" :size="15" class="mt-px shrink-0" />
        <span>Free accounts stay in <strong class="text-ink">{{ lockedTo }}</strong>. Other states unlock with Complete.</span>
      </p>
      <p v-else-if="needsConfirm" class="flex items-start gap-2 rounded-card border border-warn/25 bg-warn-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">
        <Icon name="info" :size="15" class="mt-px shrink-0 text-warn" />
        <span>Choose carefully. The free tier is one state, and you will be asked to confirm before it locks.</span>
      </p>

      <ul class="-mx-1 grid max-h-[55dvh] gap-0.5 overflow-y-auto px-1">
        <li v-for="code in list" :key="code">
          <button
            type="button"
            class="flex min-h-12 w-full items-center gap-3 rounded-card px-2.5 text-left transition-colors"
            :class="[
              code === current ? 'bg-accent-soft' : '',
              lockedTo && lockedTo !== code ? 'cursor-not-allowed opacity-45' : 'hover:bg-surface-2',
            ]"
            :aria-current="code === current || undefined"
            :aria-disabled="!!(lockedTo && lockedTo !== code) || undefined"
            :disabled="!!(lockedTo && lockedTo !== code)"
            @click="pick(code)"
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
            <Icon v-if="lockedTo && lockedTo !== code" name="lock" :size="14" class="shrink-0 text-muted" />
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
