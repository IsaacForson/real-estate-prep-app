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
const dot: Record<string, string> = { ok: "bg-ok", danger: "bg-danger", accent: "bg-accent", muted: "bg-line-strong" };
const sorted = computed(() => [...props.events].sort((a, b) => new Date(when(b) ?? 0).getTime() - new Date(when(a) ?? 0).getTime()));
</script>
<template>
  <ol class="m-0 list-none border-l border-line p-0 pl-4">
    <li v-for="(e, i) in sorted" :key="keyOf(e, i)" class="relative py-2.5 text-[13.5px]">
      <span
        class="absolute -left-[21px] top-4 size-2.5 rounded-full ring-[3px] ring-surface"
        :class="dot[tone(e.kind)]"
        aria-hidden="true"
      />

      <div class="flex flex-wrap items-center gap-2">
        <AdminBadge :text="e.kind" :tone="tone(e.kind)" />
        <NuxtLink v-if="showUser && e.user_id" :to="`/admin/users/${e.user_id}`" class="font-mono text-[11.5px] text-accent underline underline-offset-2">
          {{ adminFmt.short(e.user_id) }}
        </NuxtLink>
        <span v-if="e.device_hash" class="font-mono text-[11.5px] text-muted" :title="e.device_hash">dev {{ adminFmt.short(e.device_hash, 6) }}</span>
        <span class="ml-auto text-[11.5px] text-muted"><AdminTime :value="when(e)" /></span>
      </div>

      <button
        v-if="e.props && Object.keys(e.props).length"
        type="button"
        class="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent"
        :aria-expanded="open.has(keyOf(e, i))"
        @click="toggle(keyOf(e, i))"
      >
        <Icon name="chevron-down" :size="13" class="transition-transform duration-200" :class="open.has(keyOf(e, i)) ? 'rotate-180' : ''" />
        {{ open.has(keyOf(e, i)) ? "Hide" : "Show" }} props
      </button>

      <pre v-if="open.has(keyOf(e, i))" class="mt-1.5 max-h-48 overflow-auto rounded-lg border border-line bg-surface-2 p-2.5 text-[11.5px] leading-relaxed text-muted">{{ JSON.stringify(e.props, null, 2) }}</pre>
    </li>
  </ol>
</template>
