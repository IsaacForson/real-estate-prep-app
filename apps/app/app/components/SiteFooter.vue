<script setup lang="ts">
const year = new Date().getFullYear();
</script>
<template>
  <footer class="border-t border-line mt-16 bg-paper">
    <div class="max-w-6xl mx-auto safe-px py-10 grid gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
      <div class="grid gap-3 content-start">
        <BrandMark :size="28" wordmark />
        <p class="text-sm text-muted max-w-xs">Independent exam prep for all 50 states and DC. Every answer cites the statute it rests on. One payment, forever.</p>
        <p class="text-xs text-muted">© {{ year }} Forsare Ventures Ltd.</p>
      </div>
      <nav class="grid gap-2 text-sm content-start" aria-label="Product">
        <span class="eyebrow">Product</span>
        <NuxtLink to="/states" class="text-ink-2 hover:text-ink">States</NuxtLink>
        <NuxtLink to="/pricing" class="text-ink-2 hover:text-ink">Pricing</NuxtLink>
        <NuxtLink to="/methodology" class="text-ink-2 hover:text-ink">How readiness is computed</NuxtLink>
        <NuxtLink to="/reviews" class="text-ink-2 hover:text-ink">Reviews</NuxtLink>
      </nav>
      <nav class="grid gap-2 text-sm content-start" aria-label="Support">
        <span class="eyebrow">Support</span>
        <NuxtLink to="/help" class="text-ink-2 hover:text-ink">Help Center</NuxtLink>
        <NuxtLink to="/help/contact" class="text-ink-2 hover:text-ink">Contact us</NuxtLink>
        <NuxtLink to="/signin" class="text-ink-2 hover:text-ink">Sign in</NuxtLink>
      </nav>
      <nav class="grid gap-2 text-sm content-start" aria-label="Legal">
        <span class="eyebrow">Legal</span>
        <NuxtLink to="/legal/terms" class="text-ink-2 hover:text-ink">Terms</NuxtLink>
        <NuxtLink to="/legal/privacy" class="text-ink-2 hover:text-ink">Privacy</NuxtLink>
        <NuxtLink to="/legal/refunds" class="text-ink-2 hover:text-ink">Refunds & guarantee</NuxtLink>
        <NuxtLink to="/legal/disclaimer" class="text-ink-2 hover:text-ink">Disclaimer</NuxtLink>
      </nav>
    </div>
    <div class="max-w-6xl mx-auto safe-px pb-8 text-xs text-muted">Not affiliated with, endorsed by, or sponsored by Pearson VUE, PSI, or any state real estate commission. Trademarks belong to their owners.</div>
  </footer>
</template>
