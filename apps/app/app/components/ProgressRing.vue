<script setup lang="ts">
/** Circular progress. `value` is 0..100; slot renders in the centre. */
const props = withDefaults(defineProps<{ value: number; size?: number; stroke?: number; tone?: "accent" | "ok" | "warn" | "danger" | "auto"; label?: string }>(), { size: 120, stroke: 10, tone: "auto" });
const r = computed(() => (props.size - props.stroke) / 2);
const c = computed(() => 2 * Math.PI * r.value);
const pct = computed(() => Math.max(0, Math.min(100, props.value || 0)));
const color = computed(() => {
  const t = props.tone === "auto" ? (pct.value >= 75 ? "ok" : pct.value >= 55 ? "warn" : "danger") : props.tone;
  return { accent: "var(--accent)", ok: "var(--green)", warn: "var(--yellow)", danger: "var(--red)" }[t];
});
</script>
<template>
  <div class="relative inline-grid place-items-center" :style="{ width: `${size}px`, height: `${size}px` }" role="img" :aria-label="label ?? `${Math.round(pct)} percent`">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" class="-rotate-90">
      <circle :cx="size / 2" :cy="size / 2" :r="r" fill="none" stroke="var(--surface-3)" :stroke-width="stroke" />
      <circle :cx="size / 2" :cy="size / 2" :r="r" fill="none" :stroke="color" :stroke-width="stroke" stroke-linecap="round"
        :stroke-dasharray="c" :stroke-dashoffset="c * (1 - pct / 100)" class="transition-[stroke-dashoffset] duration-700 ease-out" />
    </svg>
    <div class="absolute inset-0 grid place-items-center text-center"><slot /></div>
  </div>
</template>
