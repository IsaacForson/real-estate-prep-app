<script setup lang="ts">
/** Three inline SVG illustrations for the welcome carousel and landing. All colours via tokens. */
defineProps<{ kind: "citation" | "states" | "readiness"; size?: number }>();
</script>
<template>
  <svg :width="size ?? 240" :height="size ?? 240" viewBox="0 0 240 240" fill="none" aria-hidden="true" class="mx-auto block max-w-full">
    <template v-if="kind === 'citation'">
      <rect x="30" y="28" width="180" height="184" rx="18" fill="var(--surface)" stroke="var(--border)" />
      <rect x="50" y="52" width="110" height="10" rx="5" fill="var(--surface-3)" />
      <rect x="50" y="70" width="140" height="10" rx="5" fill="var(--surface-3)" />
      <rect x="50" y="94" width="140" height="22" rx="8" fill="var(--surface-2)" />
      <rect x="50" y="122" width="140" height="22" rx="8" fill="var(--green-soft)" stroke="var(--green)" />
      <path d="m60 133 5 5 9-9" stroke="var(--green)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="50" y="158" width="140" height="38" rx="8" fill="var(--accent-soft)" />
      <rect x="50" y="158" width="4" height="38" rx="2" fill="var(--accent)" />
      <text x="64" y="174" font-family="Georgia, serif" font-size="13" font-weight="700" fill="var(--text)">§ 475.25(1)(b)</text>
      <rect x="64" y="181" width="100" height="6" rx="3" fill="var(--accent)" opacity=".35" />
      <circle cx="186" cy="52" r="22" fill="var(--accent)" />
      <text x="186" y="60" text-anchor="middle" font-family="Georgia, serif" font-size="24" font-weight="700" fill="var(--accent-text)">§</text>
    </template>
    <template v-else-if="kind === 'states'">
      <g fill="var(--surface-3)">
        <rect v-for="(c, i) in 42" :key="i" :x="34 + (i % 7) * 25" :y="46 + Math.floor(i / 7) * 25" width="20" height="20" rx="5" />
      </g>
      <g fill="var(--accent)">
        <rect x="34" y="46" width="20" height="20" rx="5" /><rect x="84" y="71" width="20" height="20" rx="5" /><rect x="159" y="96" width="20" height="20" rx="5" />
        <rect x="59" y="121" width="20" height="20" rx="5" /><rect x="134" y="146" width="20" height="20" rx="5" /><rect x="184" y="171" width="20" height="20" rx="5" /><rect x="109" y="46" width="20" height="20" rx="5" />
      </g>
      <g fill="var(--green)">
        <rect x="184" y="46" width="20" height="20" rx="5" /><rect x="34" y="171" width="20" height="20" rx="5" /><rect x="109" y="121" width="20" height="20" rx="5" />
      </g>
      <rect x="66" y="196" width="108" height="26" rx="13" fill="var(--surface)" stroke="var(--border)" />
      <text x="120" y="214" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="13" font-weight="600" fill="var(--text)">50 states + DC</text>
    </template>
    <template v-else>
      <circle cx="120" cy="116" r="72" stroke="var(--surface-3)" stroke-width="14" />
      <circle cx="120" cy="116" r="72" stroke="var(--green)" stroke-width="14" stroke-linecap="round" stroke-dasharray="452" stroke-dashoffset="99" transform="rotate(-90 120 116)" />
      <text x="120" y="112" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="44" font-weight="700" fill="var(--text)" letter-spacing="-1">78%</text>
      <text x="120" y="136" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="12" font-weight="600" fill="var(--muted)" letter-spacing="1">PREDICTED</text>
      <rect x="44" y="200" width="152" height="22" rx="11" fill="var(--green-soft)" />
      <text x="120" y="215" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="12" font-weight="600" fill="var(--green)">Range 70–84 of 100 · on track</text>
    </template>
  </svg>
</template>
