<script setup lang="ts">
/**
 * Three inline SVG illustrations for the welcome carousel and landing.
 *
 * Every colour is a token so both themes work without a second asset, and the type uses the same
 * two families as the rest of the app — the § is serif, exactly as it is in CitationBlock.
 */
defineProps<{ kind: "citation" | "states" | "readiness"; size?: number }>();
const SANS = "Inter Variable, system-ui, sans-serif";
const SERIF = "Source Serif 4 Variable, Georgia, serif";
</script>
<template>
  <svg :width="size ?? 240" :height="size ?? 240" viewBox="0 0 240 240" fill="none" aria-hidden="true" class="mx-auto block max-w-full">
    <!-- Every answer resolves to a quoted section of law. -->
    <template v-if="kind === 'citation'">
      <rect x="28" y="26" width="184" height="188" rx="16" fill="var(--surface)" stroke="var(--border)" />

      <rect x="48" y="48" width="96" height="8" rx="4" fill="var(--surface-3)" />
      <rect x="48" y="64" width="132" height="8" rx="4" fill="var(--surface-3)" />

      <rect x="48" y="88" width="144" height="24" rx="8" fill="var(--surface-2)" />
      <rect x="48" y="118" width="144" height="24" rx="8" fill="var(--green-soft)" stroke="var(--green)" />
      <path d="m59 130 4.5 4.5 8-8.5" stroke="var(--green)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="80" y="126" width="76" height="8" rx="4" fill="var(--green)" opacity=".28" />

      <rect x="48" y="152" width="144" height="44" rx="8" fill="var(--paper)" stroke="var(--border)" />
      <rect x="56" y="160" width="13" height="13" rx="4" fill="var(--action)" />
      <text x="62.5" y="170.5" text-anchor="middle" :font-family="SERIF" font-size="10" font-weight="600" fill="var(--action-ink)">§</text>
      <text x="76" y="170.5" :font-family="SANS" font-size="10.5" font-weight="600" fill="var(--text)">475.25(1)(b)</text>
      <rect x="56" y="180" width="128" height="6" rx="3" fill="var(--surface-3)" />

      <circle cx="196" cy="44" r="20" fill="var(--action)" />
      <text x="196" y="52" text-anchor="middle" :font-family="SERIF" font-size="22" font-weight="600" fill="var(--action-ink)">§</text>
    </template>

    <!-- 50 states and DC: some complete, some in production, the rest planned. -->
    <template v-else-if="kind === 'states'">
      <g fill="var(--surface-3)">
        <rect v-for="(c, i) in 42" :key="i" :x="34 + (i % 7) * 25" :y="42 + Math.floor(i / 7) * 25" width="19" height="19" rx="5" />
      </g>
      <g fill="var(--accent)">
        <rect x="34" y="42" width="19" height="19" rx="5" />
        <rect x="84" y="67" width="19" height="19" rx="5" />
        <rect x="159" y="92" width="19" height="19" rx="5" />
        <rect x="59" y="117" width="19" height="19" rx="5" />
        <rect x="134" y="142" width="19" height="19" rx="5" />
        <rect x="184" y="167" width="19" height="19" rx="5" />
        <rect x="109" y="42" width="19" height="19" rx="5" />
      </g>
      <g fill="var(--green)">
        <rect x="184" y="42" width="19" height="19" rx="5" />
        <rect x="34" y="167" width="19" height="19" rx="5" />
        <rect x="109" y="117" width="19" height="19" rx="5" />
      </g>

      <rect x="62" y="198" width="116" height="28" rx="14" fill="var(--surface)" stroke="var(--border)" />
      <text x="120" y="216" text-anchor="middle" :font-family="SANS" font-size="12.5" font-weight="600" fill="var(--text)">50 states + DC</text>
    </template>

    <!-- A predicted score with the honest range under it. -->
    <template v-else>
      <circle cx="120" cy="112" r="70" stroke="var(--surface-3)" stroke-width="12" />
      <circle
        cx="120" cy="112" r="70"
        stroke="var(--green)" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="440" stroke-dashoffset="97"
        transform="rotate(-90 120 112)"
      />
      <text x="120" y="110" text-anchor="middle" :font-family="SANS" font-size="42" font-weight="600" fill="var(--text)" letter-spacing="-1.6">78%</text>
      <text x="120" y="132" text-anchor="middle" :font-family="SANS" font-size="10" font-weight="600" fill="var(--muted)" letter-spacing="1.4">PREDICTED</text>

      <rect x="42" y="200" width="156" height="26" rx="13" fill="var(--green-soft)" />
      <text x="120" y="217" text-anchor="middle" :font-family="SANS" font-size="11.5" font-weight="600" fill="var(--green)">Range 70–84 of 100 · on track</text>
    </template>
  </svg>
</template>
