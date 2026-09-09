<script setup lang="ts">
import { JURISDICTIONS, JURISDICTION_CODES } from "@rep/schema";
/** Web landing. On Capacitor the auth middleware sends `/` to /welcome. */
useHead({
  title: "Real Estate Exam Prep — all 50 states + DC, statute-cited answers, $59 once",
  meta: [{ name: "description", content: "The only real estate exam prep that covers every state portion, cites the statute behind every answer, and costs one payment forever. 40 free questions in your state." }],
});
const auth = useAuth();
const reviews = useReviews();
const content = useContent();
const { data: manifest } = await useAsyncData("manifest", () => content.load());
const approved = computed(() => (reviews.approved.value ?? []).slice(0, 3));
onMounted(() => { void reviews.loadApproved(6); });
const complete = computed(() => JURISDICTION_CODES.filter((c) => manifest.value?.status[c]?.phase === "complete"));
const inProduction = computed(() => JURISDICTION_CODES.filter((c) => { const s = manifest.value?.status[c]; return s && s.phase !== "complete" && s.verified + s.published > 0; }));
const totalQuestions = computed(() => Object.values(manifest.value?.status ?? {}).reduce((a, s) => a + s.published, 0) + Object.values(manifest.value?.nationalStatus ?? {}).reduce((a, s) => a + s.published, 0));
const faq = [
  { q: "Is this a subscription?", a: "No. $59 once buys everything, forever: all 51 jurisdictions, both national banks, every mock, and all future content and statute updates. The free tier needs no card." },
  { q: "Which national exam do you prepare me for?", a: "Both. Pearson VUE and PSI each publish their own national outline with different weights. Your state's vendor decides which bank we route you to." },
  { q: "My state is marked \"in production\". What do I get?", a: "You own it. Its questions arrive as they pass verification by a licensed reviewer. We show real counts per state rather than padding a bank to look finished." },
  { q: "Where do the citations come from?", a: "Every item cites the statute or rule it rests on, quotes it verbatim, and links the official text. Items are re-verified when a cited section changes." },
  { q: "What is the pass guarantee?", a: "An optional +$20 add-on: a full refund of both payments on proof of a failed attempt within 90 days, provided you completed five full-length mocks." },
  { q: "Is this affiliated with Pearson VUE, PSI or my state?", a: "No. We are an independent study aid. Blueprints are used as internal targets only; no vendor material is reproduced." },
];
const openFaq = ref<number | null>(0);
const spotlight = ["FL", "TX", "CA", "NY", "GA", "NC", "IL", "AZ", "PA", "OH", "WA", "NJ"] as const;
</script>
<template>
  <div>
    <!-- Hero -->
    <section class="relative overflow-hidden">
      <div class="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--accent-soft),transparent_60%)]" aria-hidden="true" />
      <div class="max-w-6xl mx-auto safe-px pt-14 md:pt-24 pb-12 grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center">
        <div class="grid gap-6">
          <Badge tone="accent" size="md"><Icon name="map" :size="14" />All 50 states + DC</Badge>
          <h1 class="text-4xl sm:text-5xl md:text-6xl display">The state portion is where candidates fail. <span class="text-accent">We cover it.</span></h1>
          <p class="text-lg md:text-xl text-ink-2 max-w-xl">Every answer cites the statute it rests on. Both national banks, correctly weighted. One payment, forever — no daily limits, no upsells, no trial that bills you.</p>
          <div class="flex flex-wrap gap-3">
            <AppButton :to="auth.signedIn.value ? '/app' : '/signin'" variant="primary" size="lg" icon-right="arrow-right">{{ auth.signedIn.value ? 'Open the app' : 'Start free — 40 questions' }}</AppButton>
            <AppButton to="/pricing" variant="secondary" size="lg">$59 once, everything</AppButton>
          </div>
          <ul class="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
            <li class="inline-flex items-center gap-1.5"><Icon name="check" :size="16" class="text-ok" />No card for the free tier</li>
            <li class="inline-flex items-center gap-1.5"><Icon name="check" :size="16" class="text-ok" />Official-text citations</li>
            <li class="inline-flex items-center gap-1.5"><Icon name="check" :size="16" class="text-ok" />Works offline</li>
          </ul>
        </div>
        <div class="lg:pl-6"><StatuteDemoCard /></div>
      </div>
    </section>

    <!-- Proof strip -->
    <section class="border-y border-line bg-paper">
      <div class="max-w-6xl mx-auto safe-px py-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
        <div><p class="text-2xl md:text-3xl display tabular">51</p><p class="text-xs text-muted">jurisdictions, one price</p></div>
        <div><p class="text-2xl md:text-3xl display tabular">2</p><p class="text-xs text-muted">national banks (Pearson VUE · PSI)</p></div>
        <div><p class="text-2xl md:text-3xl display tabular">{{ totalQuestions ? totalQuestions.toLocaleString() : '—' }}</p><p class="text-xs text-muted">published questions, each cited</p></div>
        <div><p class="text-2xl md:text-3xl display tabular">$59</p><p class="text-xs text-muted">once. Not per month.</p></div>
      </div>
    </section>

    <!-- How it works -->
    <section class="max-w-6xl mx-auto safe-px py-16 md:py-24 grid gap-10">
      <header class="grid gap-2 max-w-2xl"><p class="eyebrow text-accent">How it works</p><h2 class="text-3xl md:text-4xl display">Built to the blueprint, graded honestly.</h2></header>
      <div class="grid md:grid-cols-3 gap-4">
        <AppCard padding="lg"><OnboardingArt kind="states" :size="160" /><h3 class="mt-4 text-lg font-semibold">1. Pick your state</h3><p class="mt-1 text-sm text-ink-2">We load your state's law bank and route you to the national bank your exam vendor actually uses, weighted to its published outline.</p></AppCard>
        <AppCard padding="lg"><OnboardingArt kind="citation" :size="160" /><h3 class="mt-4 text-lg font-semibold">2. Answer, then read the law</h3><p class="mt-1 text-sm text-ink-2">Immediate feedback with an explanation and the statute quoted verbatim. Missed questions come back on a spaced schedule until they stick.</p></AppCard>
        <AppCard padding="lg"><OnboardingArt kind="readiness" :size="160" /><h3 class="mt-4 text-lg font-semibold">3. Know when you're ready</h3><p class="mt-1 text-sm text-ink-2">A predicted score with a 90% range and a chance of passing, computed only from your answers. <NuxtLink to="/methodology" class="text-accent font-medium">The formula is public.</NuxtLink></p></AppCard>
      </div>
    </section>

    <!-- The 51-state promise -->
    <section class="bg-surface border-y border-line">
      <div class="max-w-6xl mx-auto safe-px py-16 md:py-24 grid lg:grid-cols-[1fr_1.2fr] gap-10 items-start">
        <div class="grid gap-4">
          <p class="eyebrow text-accent">The 51-state promise</p>
          <h2 class="text-3xl md:text-4xl display">Every state portion. Shown honestly.</h2>
          <p class="text-ink-2">Incumbents own the national portion and have abandoned the state half — their own reviews say so. We ship the 51-state architecture now and the content progressively, and we show you the real count for your state rather than padding a bank to look finished. Buy once and you own every state, including the ones still in production.</p>
          <div class="flex flex-wrap gap-2 text-sm">
            <Badge tone="ok" size="md">{{ complete.length }} complete</Badge>
            <Badge tone="warn" size="md">{{ inProduction.length }} in production</Badge>
            <Badge tone="outline" size="md">{{ 51 - complete.length - inProduction.length }} planned</Badge>
          </div>
          <AppButton to="/states" variant="secondary" icon-right="arrow-right" class="justify-self-start">Every state's exam brief</AppButton>
        </div>
        <ul class="grid grid-cols-3 sm:grid-cols-4 gap-2">
          <li v-for="c in spotlight" :key="c">
            <NuxtLink :to="`/states/${c}`" class="block rounded-card bg-bg border border-line p-3 hover:border-line-strong transition-colors">
              <p class="font-semibold">{{ JURISDICTIONS[c] }}</p>
              <p class="text-xs text-muted mt-0.5">{{ manifest?.states[c]?.vendor ?? '—' }} · {{ manifest?.status[c]?.phase === 'complete' ? `${manifest?.status[c]?.published} questions` : (manifest?.status[c]?.verified ?? 0) + (manifest?.status[c]?.published ?? 0) > 0 ? 'in production' : 'planned' }}</p>
            </NuxtLink>
          </li>
        </ul>
      </div>
    </section>

    <!-- Pricing summary -->
    <section class="max-w-6xl mx-auto safe-px py-16 md:py-24 grid gap-8">
      <header class="grid gap-2 max-w-2xl"><p class="eyebrow text-accent">Pricing</p><h2 class="text-3xl md:text-4xl display">$59. Once. Everything.</h2><p class="text-ink-2">The loudest complaint about every other prep app is the paywall. Ours has one door and it's open forever.</p></header>
      <div class="grid md:grid-cols-3 gap-4">
        <AppCard padding="lg"><p class="eyebrow">Free</p><p class="mt-1 text-3xl display">$0</p><p class="mt-3 text-sm text-ink-2">40 questions in one state with full explanations and citations, one short mock. No card.</p></AppCard>
        <AppCard padding="lg" class="ring-2 ring-accent"><p class="eyebrow">Complete</p><p class="mt-1 text-3xl display">$59 <span class="text-sm text-muted font-normal">once</span></p><p class="mt-3 text-sm text-ink-2">All 51 jurisdictions, both national banks, every mock, audio, offline, all future updates.</p><AppButton to="/pricing" variant="primary" class="mt-4" icon-right="arrow-right">See what's included</AppButton></AppCard>
        <AppCard padding="lg"><p class="eyebrow">Pass guarantee</p><p class="mt-1 text-3xl display">+$20</p><p class="mt-3 text-sm text-ink-2">Full refund of both payments on proof of a failed attempt within 90 days, after five full-length mocks.</p></AppCard>
      </div>
    </section>

    <!-- Reviews -->
    <section v-if="approved.length" class="bg-paper border-y border-line">
      <div class="max-w-6xl mx-auto safe-px py-16 grid gap-8">
        <header class="flex items-end justify-between gap-4"><div class="grid gap-2"><p class="eyebrow text-accent">Reviews</p><h2 class="text-3xl display">From candidates</h2></div><NuxtLink to="/reviews" class="text-sm font-medium text-accent inline-flex items-center gap-1">All reviews <Icon name="arrow-right" :size="16" /></NuxtLink></header>
        <div class="grid md:grid-cols-3 gap-4">
          <article v-for="r in approved" :key="r.id" class="rounded-card bg-surface border border-line p-5 grid gap-2">
            <span class="inline-flex text-warn"><Icon v-for="n in 5" :key="n" :name="n <= r.rating ? 'star-filled' : 'star'" :size="16" :class="n <= r.rating ? '' : 'text-line-strong'" /></span>
            <p class="text-[15px] text-ink-2 leading-relaxed line-clamp-5">{{ r.body }}</p>
            <p class="text-xs text-muted">Candidate<template v-if="r.jurisdiction"> · {{ r.jurisdiction }}</template></p>
          </article>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section class="max-w-3xl mx-auto safe-px py-16 md:py-24 grid gap-6">
      <header class="grid gap-2"><p class="eyebrow text-accent">FAQ</p><h2 class="text-3xl display">Questions we get</h2></header>
      <div class="grid gap-2">
        <article v-for="(f, i) in faq" :key="f.q" class="rounded-card bg-surface border border-line overflow-hidden">
          <button type="button" class="w-full text-left px-5 py-4 flex items-center gap-3 hover:bg-surface-2" :aria-expanded="openFaq === i" @click="openFaq = openFaq === i ? null : i"><span class="flex-1 font-medium">{{ f.q }}</span><Icon name="chevron-down" :size="18" class="text-muted transition-transform" :class="openFaq === i ? 'rotate-180' : ''" /></button>
          <p v-if="openFaq === i" class="px-5 pb-5 text-ink-2 text-[15px] leading-relaxed">{{ f.a }}</p>
        </article>
      </div>
    </section>

    <!-- Final CTA -->
    <section class="max-w-6xl mx-auto safe-px pb-8">
      <div class="rounded-[var(--radius-lg)] bg-accent text-accent-ink p-8 md:p-12 grid md:grid-cols-[1fr_auto] gap-6 items-center">
        <div class="grid gap-2"><h2 class="text-3xl md:text-4xl display">Failed the state portion? That's the half nobody prepared you for.</h2><p class="opacity-85">Start with 40 free questions in your state. Every one comes with its citation.</p></div>
        <AppButton :to="auth.signedIn.value ? '/app' : '/signin'" size="lg" class="!bg-white !text-[#2d3fc4] hover:!brightness-95" icon-right="arrow-right">{{ auth.signedIn.value ? 'Open the app' : 'Start free' }}</AppButton>
      </div>
    </section>
  </div>
</template>
