<script setup lang="ts">
/** Vertical list of `events` rows (latest first) with expandable props. */
import type { AdminEvent } from "~/composables/useAdmin";

const props = defineProps<{ events: AdminEvent[]; showUser?: boolean }>();
const open = ref<Set<string>>(new Set());
const keyOf = (e: AdminEvent, i: number) => e.id ?? `${e.kind}-${e.at ?? e.created_at ?? i}-${i}`;
const when = (e: AdminEvent) => e.at ?? e.created_at ?? null;
function toggle(k: string) {
  const s = new Set(open.value);
  if (s.has(k)) s.delete(k); else s.add(k);
  open.value = s;
}
const tone = (kind: string) => (kind.startsWith("purchase") ? "ok" : kind.includes("refund") || kind.includes("error") ? "danger" : kind.startsWith("mock") ? "accent" : "muted") as "ok" | "danger" | "accent" | "muted";
const sorted = computed(() => [...props.events].sort((a, b) => new Date(when(b) ?? 0).getTime() - new Date(when(a) ?? 0).getTime()));
</script>
<template>
  <ol class="m-0 list-none border-l border-line p-0 pl-4">
    <li v-for="(e, i) in sorted" :key="keyOf(e, i)" class="relative py-2 text-sm">
      <span class="absolute -left-[21px] top-3.5 size-2.5 rounded-full border-2 border-surface" :class="{ 'bg-ok': tone(e.kind) === 'ok', 'bg-danger': tone(e.kind) === 'danger', 'bg-accent': tone(e.kind) === 'accent', 'bg-muted': tone(e.kind) === 'muted' }" aria-hidden="true" />
      <div class="flex flex-wrap items-center gap-2">
        <AdminBadge :text="e.kind" :tone="tone(e.kind)" />
        <NuxtLink v-if="showUser && e.user_id" :to="`/admin/users/${e.user_id}`" class="font-mono text-xs">{{ adminFmt.short(e.user_id) }}</NuxtLink>
        <span v-if="e.device_hash" class="font-mono text-xs text-muted" :title="e.device_hash">dev {{ adminFmt.short(e.device_hash, 6) }}</span>
        <span class="ml-auto text-xs text-muted"><AdminTime :value="when(e)" /></span>
      </div>
      <button
        v-if="e.props && Object.keys(e.props).length"
        type="button"
        class="mt-1 !border-0 !bg-transparent !p-0 text-xs text-accent"
        :aria-expanded="open.has(keyOf(e, i))"
        @click="toggle(keyOf(e, i))"
      >{{ open.has(keyOf(e, i)) ? "Hide" : "Show" }} props</button>
      <pre v-if="open.has(keyOf(e, i))" class="mt-1 max-h-48 overflow-auto rounded bg-surface-2 p-2 text-xs text-muted">{{ JSON.stringify(e.props, null, 2) }}</pre>
    </li>
  </ol>
</template>
