<script setup lang="ts">
const year = new Date().getFullYear();
const groups = [
  {
    label: "Product",
    links: [
      { to: "/states", text: "States" },
      { to: "/pricing", text: "Pricing" },
      { to: "/methodology", text: "How readiness is computed" },
      { to: "/reviews", text: "Reviews" },
    ],
  },
  {
    label: "Support",
    links: [
      { to: "/help", text: "Help Center" },
      { to: "/help/contact", text: "Contact us" },
      { to: "/signin", text: "Sign in" },
    ],
  },
  {
    label: "Legal",
    links: [
      { to: "/legal/terms", text: "Terms" },
      { to: "/legal/privacy", text: "Privacy" },
      { to: "/legal/refunds", text: "Refunds & guarantee" },
      { to: "/legal/disclaimer", text: "Disclaimer" },
    ],
  },
];
</script>
<template>
  <footer class="mt-20 border-t border-line bg-paper">
    <div class="safe-px mx-auto grid max-w-6xl gap-10 py-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
      <div class="grid content-start gap-3.5">
        <BrandMark :size="28" wordmark />
        <p class="max-w-[34ch] text-[13.5px] leading-relaxed text-muted">
          Independent exam prep for all 50 states and DC. Every answer cites the statute it rests on.
          One payment, forever.
        </p>
      </div>

      <nav v-for="g in groups" :key="g.label" class="grid content-start gap-2.5" :aria-label="g.label">
        <span class="eyebrow">{{ g.label }}</span>
        <NuxtLink
          v-for="l in g.links"
          :key="l.to"
          :to="l.to"
          class="text-[13.5px] text-ink-2 transition-colors hover:text-ink"
        >{{ l.text }}</NuxtLink>
      </nav>
    </div>

    <div class="safe-px mx-auto max-w-6xl border-t border-line py-6">
      <p class="text-[12px] leading-relaxed text-muted">
        Not affiliated with, endorsed by, or sponsored by Pearson VUE, PSI, or any state real estate
        commission. Trademarks belong to their owners.
      </p>
      <p class="mt-2 text-[12px] text-muted">© {{ year }} Forsare Ventures Ltd.</p>
    </div>
  </footer>
</template>
