<script setup lang="ts">
/**
 * Dependency-free SVG chart for KPI series. `type="line"` draws one path per series (with a soft
 * area fill under the first); `type="bar"` draws grouped bars. Colours are CSS variables from
 * main.css so dark/light follow the theme.
 *
 * Hover or focus a column to read the values for that date; the readout is `aria-live` so keyboard
 * users get the same information as a pointer hover.
 */
export interface ChartSeries { name: string; values: number[]; color?: "accent" | "ok" | "warn" | "danger" | "muted" }

const props = withDefaults(defineProps<{
  labels: string[];
  series: ChartSeries[];
  type?: "line" | "bar";
  height?: number;
  format?: (n: number) => string;
  title?: string;
}>(), { type: "line", height: 180, format: (n: number) => adminFmt.int(n) });

const W = 640;
const PAD = { l: 44, r: 12, t: 14, b: 26 };
const H = computed(() => props.height);
const innerW = W - PAD.l - PAD.r;
const innerH = computed(() => H.value - PAD.t - PAD.b);
const n = computed(() => props.labels.length);

const uid = `cg-${Math.random().toString(36).slice(2, 8)}`;

const maxY = computed(() => {
  let m = 0;
  for (const s of props.series) for (const v of s.values) if (Number.isFinite(v) && v > m) m = v;
  if (m === 0) return 1;
  // round up to a "nice" tick
  const p = 10 ** Math.floor(Math.log10(m));
  const f = m / p;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * p;
});
const ticks = computed(() => [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxY.value));

const x = (i: number) => (n.value <= 1 ? PAD.l + innerW / 2 : PAD.l + (i / (n.value - 1)) * innerW);
const y = (v: number) => PAD.t + innerH.value - (Math.max(0, v) / maxY.value) * innerH.value;

const colorVar: Record<string, string> = { accent: "var(--accent)", ok: "var(--green)", warn: "var(--yellow)", danger: "var(--red)", muted: "var(--muted)" };
const stroke = (s: ChartSeries, i: number) => colorVar[s.color ?? ["accent", "ok", "warn", "danger", "muted"][i % 5]!]!;

const paths = computed(() => props.series.map((s) => s.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")));
/** Closed version of the first series' path, for the area tint that anchors the line to the axis. */
const area = computed(() => {
  const s = props.series[0];
  if (!s?.values.length || props.type !== "line") return "";
  const base = (PAD.t + innerH.value).toFixed(1);
  return `${paths.value[0]} L${x(s.values.length - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`;
});

// bars: group width per label, one bar per series
const slot = computed(() => (n.value ? innerW / n.value : innerW));
const barW = computed(() => Math.max(2, Math.min(26, (slot.value * 0.68) / Math.max(1, props.series.length))));
const barX = (i: number, si: number) => PAD.l + i * slot.value + slot.value / 2 - (barW.value * props.series.length) / 2 + si * barW.value;

const labelEvery = computed(() => Math.max(1, Math.ceil(n.value / 8)));
const shortLabel = (l: string) => {
  const d = new Date(l);
  return Number.isNaN(d.getTime()) ? l : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const hover = ref<number | null>(null);
function onMove(e: MouseEvent) {
  const svg = e.currentTarget as SVGSVGElement;
  const r = svg.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * W;
  if (!n.value) return;
  const i = props.type === "bar" ? Math.floor((px - PAD.l) / slot.value) : Math.round(((px - PAD.l) / innerW) * (n.value - 1));
  hover.value = i >= 0 && i < n.value ? i : null;
}
function onKey(e: KeyboardEvent) {
  if (!n.value) return;
  if (e.key === "ArrowRight") { e.preventDefault(); hover.value = Math.min(n.value - 1, (hover.value ?? -1) + 1); }
  if (e.key === "ArrowLeft") { e.preventDefault(); hover.value = Math.max(0, (hover.value ?? n.value) - 1); }
  if (e.key === "Escape") hover.value = null;
}
const hoverText = computed(() => {
  const i = hover.value;
  if (i == null || !props.labels[i]) return "";
  return `${shortLabel(props.labels[i]!)}: ${props.series.map((s) => `${s.name} ${props.format(s.values[i] ?? 0)}`).join(" · ")}`;
});
</script>
<template>
  <figure class="m-0">
    <div v-if="!labels.length" class="rounded-card border border-dashed border-line p-6 text-center text-[13.5px] text-muted">
      No data for this range.
    </div>

    <template v-else>
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        class="block w-full select-none text-ink"
        role="img"
        :aria-label="title ?? series.map((s) => s.name).join(', ')"
        tabindex="0"
        @mousemove="onMove"
        @mouseleave="hover = null"
        @keydown="onKey"
        @blur="hover = null"
      >
        <defs>
          <linearGradient :id="uid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" :stop-color="stroke(series[0]!, 0)" stop-opacity="0.16" />
            <stop offset="100%" :stop-color="stroke(series[0]!, 0)" stop-opacity="0" />
          </linearGradient>
        </defs>

        <!-- gridlines + y labels -->
        <g v-for="t in ticks" :key="t">
          <line :x1="PAD.l" :x2="W - PAD.r" :y1="y(t)" :y2="y(t)" stroke="var(--border)" stroke-width="1" />
          <text :x="PAD.l - 8" :y="y(t) + 3.5" text-anchor="end" font-size="10" font-weight="500" fill="var(--muted)">{{ format(t) }}</text>
        </g>

        <!-- x labels -->
        <text
          v-for="(l, i) in labels"
          v-show="i % labelEvery === 0 || i === labels.length - 1"
          :key="l"
          :x="type === 'bar' ? PAD.l + i * slot + slot / 2 : x(i)"
          :y="H - 8"
          text-anchor="middle"
          font-size="10"
          font-weight="500"
          fill="var(--muted)"
        >{{ shortLabel(l) }}</text>

        <template v-if="type === 'bar'">
          <g v-for="(s, si) in series" :key="s.name">
            <rect
              v-for="(v, i) in s.values"
              :key="i"
              :x="barX(i, si)"
              :y="y(v)"
              :width="barW"
              :height="Math.max(0, innerH + PAD.t - y(v))"
              :fill="stroke(s, si)"
              :opacity="hover === null || hover === i ? 0.92 : 0.4"
              rx="2"
            />
          </g>
        </template>

        <template v-else>
          <path v-if="area" :d="area" :fill="`url(#${uid})`" stroke="none" />
          <path
            v-for="(s, si) in series"
            :key="s.name"
            :d="paths[si]"
            fill="none"
            :stroke="stroke(s, si)"
            stroke-width="1.75"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
          <g v-if="hover !== null">
            <line :x1="x(hover)" :x2="x(hover)" :y1="PAD.t" :y2="PAD.t + innerH" stroke="var(--border-strong)" stroke-dasharray="3 3" />
            <circle
              v-for="(s, si) in series"
              :key="s.name"
              :cx="x(hover)"
              :cy="y(s.values[hover] ?? 0)"
              r="3.5"
              :fill="stroke(s, si)"
              stroke="var(--surface)"
              stroke-width="2"
            />
          </g>
        </template>
      </svg>

      <figcaption class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
        <span v-for="(s, si) in series" :key="s.name" class="inline-flex items-center gap-1.5">
          <span class="inline-block size-2 rounded-full" :style="{ background: stroke(s, si) }" aria-hidden="true" />{{ s.name }}
        </span>
        <span class="tabular ml-auto text-ink" aria-live="polite">{{ hoverText || "Hover or use ← → for values" }}</span>
      </figcaption>
    </template>
  </figure>
</template>
