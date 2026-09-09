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
  ok: "border-ok/40 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/40 bg-danger/10 text-danger",
  accent: "border-accent/40 bg-accent/10 text-accent",
  muted: "border-line bg-surface-2 text-muted",
};
</script>
<template>
  <span class="inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium" :class="cls[tone]">{{ text || "—" }}</span>
</template>
