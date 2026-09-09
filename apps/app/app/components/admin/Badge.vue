<script setup lang="ts">
/** Status pill. `tone` can be given explicitly or inferred from common status words. */
const props = defineProps<{ text: string | null | undefined; tone?: "ok" | "warn" | "danger" | "accent" | "muted" }>();
const tone = computed(() => {
  if (props.tone) return props.tone;
  const t = (props.text ?? "").toLowerCase();
  if (/(open|pending|paused|waiting|flagged|new)/.test(t)) return "warn";
  if (/(approved|active|complete|resolved|closed|granted|ok|enabled|published)/.test(t)) return "ok";
  if (/(rejected|blocked|disabled|revoked|banned|refund|failed|error)/.test(t)) return "danger";
  return "muted";
});
const cls: Record<string, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  accent: "bg-accent-soft text-accent",
  muted: "bg-surface-2 text-muted",
};
</script>
<template>
  <span class="inline-block whitespace-nowrap rounded-pill px-2 py-1 text-[11.5px] font-medium leading-none" :class="cls[tone]">{{ text || "—" }}</span>
</template>
