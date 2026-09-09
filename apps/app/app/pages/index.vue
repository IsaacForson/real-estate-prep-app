<script setup lang="ts">
import { JURISDICTIONS, JURISDICTION_CODES } from "@rep/schema";
/** Web landing. On Capacitor the auth middleware sends `/` to /welcome. */
useHead({
  title: "Real Estate Exam Prep — all 50 states + DC, statute-cited answers, $59 once",
  meta: [{ name: "description", content: "The only real estate exam prep that covers every state portion, cites the statute behind every answer, and costs one payment forever. 20 free questions in your state." }],
});
const auth = useAuth();
const reviews = useReviews();
const content = useContent();
const { data: manifest } = await useAsyncData("manifest", () => content.load());
const approved = computed(() => (reviews.approved.value ?? []).slice(0, 3));
onMounted(() => { void reviews.loadApproved(6); });
const complete = computed(() => JURISDICTION_CODES.filter((c) => manifest.value?.status?.[c]?.phase === "complete"));
const inProduction = computed(() => JURISDICTION_CODES.filter((c) => { const s = manifest.value?.status?.[c]; return s && s.phase !== "complete" && s.verified + s.published > 0; }));
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
const steps = [
  { art: "states", n: "1", h: "Pick your state", b: "We load your state's law bank and route you to the national bank your exam vendor actually uses, weighted to its published outline." },
  { art: "citation", n: "2", h: "Answer, then read the law", b: "Immediate feedback with an explanation and the statute quoted verbatim. Missed questions come back on a spaced schedule until they stick." },
  { art: "readiness", n: "3", h: "Know when you're ready", b: "A predicted score with a 90% range and a chance of passing, computed only from your answers." },
] as const;
</script>
<template>
  <div>
    <!--
      Hero. No coloured glow: the canvas stays quiet and the demo card carries the visual weight,
      because the product's argument is the citation, not the gradient.
    -->
    <section class="relative overflow-hidden border-b border-line">
      <div class="absolute inset-0 -z-10 bg-gradient-to-b from-paper to-bg" aria-hidden="true" />
      <div class="safe-px mx-auto grid max-w-6xl items-center gap-12 pt-14 pb-14 md:pt-24 lg:grid-cols-[1.05fr_1fr]">
        <div class="grid gap-6">
          <Badge tone="accent" size="md" class="justify-self-start"><Icon name="map" :size="13" />All 50 states + DC</Badge>

          <h1 class="display text-[38px] sm:text-[52px] md:text-[60px]">
            The state portion is where candidates fail.
            <span class="text-muted">We cover it.</span>
          </h1>

          <p class="max-w-xl text-[17px] leading-relaxed text-ink-2 md:text-[19px]">
            Every answer cites the statute it rests on. Both national banks, correctly weighted.
            One payment, forever — no daily limits, no upsells, no trial that bills you.
          </p>

          <div class="flex flex-wrap gap-2.5">
            <AppButton :to="auth.signedIn.value ? '/app' : '/signin'" variant="primary" size="lg" icon-right="arrow-right">
              {{ auth.signedIn.value ? 'Open the app' : 'Start free — 20 questions' }}
            </AppButton>
            <AppButton to="/pricing" variant="secondary" size="lg">$59 once, everything</AppButton>
          </div>

          <ul class="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted">
            <li class="inline-flex items-center gap-1.5"><Icon name="check" :size="15" class="text-ok" />No card for the free tier</li>
            <li class="inline-flex items-center gap-1.5"><Icon name="check" :size="15" class="text-ok" />Official-text citations</li>
            <li class="inline-flex items-center gap-1.5"><Icon name="check" :size="15" class="text-ok" />Works offline</li>
          </ul>
        </div>

        <div class="lg:pl-6"><StatuteDemoCard /></div>
      </div>
    </section>

    <!-- Proof strip -->
    <section class="border-b border-line bg-paper">
      <div class="safe-px mx-auto grid max-w-6xl grid-cols-2 gap-6 py-8 md:grid-cols-4">
        <div>
          <p class="tabular display text-[30px]">51</p>
          <p class="mt-1 text-[12px] text-muted">jurisdictions, one price</p>
        </div>
        <div>
          <p class="tabular display text-[30px]">2</p>
          <p class="mt-1 text-[12px] text-muted">national banks (Pearson VUE · PSI)</p>
        </div>
        <div>
          <p class="tabular display text-[30px]">{{ totalQuestions ? totalQuestions.toLocaleString() : '—' }}</p>
          <p class="mt-1 text-[12px] text-muted">published questions, each cited</p>
        </div>
        <div>
          <p class="tabular display text-[30px]">$59</p>
          <p class="mt-1 text-[12px] text-muted">once. Not per month.</p>
        </div>
      </div>
    </section>

    <!-- How it works -->
    <section class="safe-px mx-auto grid max-w-6xl gap-10 py-16 md:py-24">
      <header class="grid max-w-2xl gap-2.5">
        <p class="eyebrow">How it works</p>
        <h2 class="display text-[30px] md:text-[38px]">Built to the blueprint, graded honestly.</h2>
      </header>

      <div class="grid gap-4 md:grid-cols-3">
        <AppCard v-for="s in steps" :key="s.n" padding="lg">
          <OnboardingArt :kind="s.art" :size="160" />
          <p class="eyebrow mt-5">Step {{ s.n }}</p>
          <h3 class="mt-1.5 text-[17px] font-semibold tracking-[-0.014em]">{{ s.h }}</h3>
          <p class="mt-2 text-[13.5px] leading-relaxed text-ink-2">
            {{ s.b }}
            <NuxtLink v-if="s.art === 'readiness'" to="/methodology" class="font-medium text-accent underline underline-offset-2">The formula is public.</NuxtLink>
          </p>
        </AppCard>
      </div>
    </section>

    <!-- The 51-state promise -->
    <section class="border-y border-line bg-surface">
      <div class="safe-px mx-auto grid max-w-6xl items-start gap-12 py-16 md:py-24 lg:grid-cols-[1fr_1.15fr]">
        <div class="grid gap-4">
          <p class="eyebrow">The 51-state promise</p>
          <h2 class="display text-[30px] md:text-[38px]">Every state portion. Shown honestly.</h2>
          <p class="text-[15px] leading-relaxed text-ink-2">
            Incumbents own the national portion and have abandoned the state half — their own reviews
            say so. We ship the 51-state architecture now and the content progressively, and we show
            you the real count for your state rather than padding a bank to look finished. Buy once
            and you own every state, including the ones still in production.
          </p>
          <div class="flex flex-wrap gap-2 pt-1">
            <Badge tone="ok" size="md">{{ complete.length }} complete</Badge>
            <Badge tone="warn" size="md">{{ inProduction.length }} in production</Badge>
            <Badge tone="outline" size="md">{{ 51 - complete.length - inProduction.length }} planned</Badge>
          </div>
          <AppButton to="/states" variant="secondary" icon-right="arrow-right" class="mt-2 justify-self-start">Every state's exam brief</AppButton>
        </div>

        <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <li v-for="c in spotlight" :key="c">
            <NuxtLink
              :to="`/states/${c}`"
              class="block rounded-card border border-line bg-bg p-3.5 transition-colors hover:border-line-strong hover:bg-surface-2"
            >
              <p class="text-[14px] font-semibold">{{ JURISDICTIONS[c] }}</p>
              <p class="mt-1 text-[11.5px] text-muted">
                {{ manifest?.states?.[c]?.vendor ?? '—' }} ·
                {{ manifest?.status?.[c]?.phase === 'complete'
                  ? `${manifest?.status?.[c]?.published} questions`
                  : (manifest?.status?.[c]?.verified ?? 0) + (manifest?.status?.[c]?.published ?? 0) > 0 ? 'in production' : 'planned' }}
              </p>
            </NuxtLink>
          </li>
        </ul>
      </div>
    </section>

    <!-- Pricing summary -->
    <section class="safe-px mx-auto grid max-w-6xl gap-8 py-16 md:py-24">
      <header class="grid max-w-2xl gap-2.5">
        <p class="eyebrow">Pricing</p>
        <h2 class="display text-[30px] md:text-[38px]">$59. Once. Everything.</h2>
        <p class="text-[15px] leading-relaxed text-ink-2">
          The loudest complaint about every other prep app is the paywall. Ours has one door and it's
          open forever.
        </p>
      </header>

      <div class="grid gap-4 md:grid-cols-3">
        <AppCard padding="lg">
          <p class="eyebrow">Free</p>
          <p class="tabular display mt-1.5 text-[32px]">$0</p>
          <p class="mt-3.5 text-[13.5px] leading-relaxed text-ink-2">20 questions in one state with full explanations and citations, one short mock. No card.</p>
        </AppCard>

        <AppCard padding="lg" class="ring-2 ring-ink/10">
          <div class="flex items-center justify-between gap-2">
            <p class="eyebrow">Complete</p>
            <Badge tone="accent">Most take this</Badge>
          </div>
          <p class="tabular display mt-1.5 text-[32px]">$59 <span class="text-[14px] font-normal text-muted">once</span></p>
          <p class="mt-3.5 text-[13.5px] leading-relaxed text-ink-2">All 51 jurisdictions, both national banks, every mock, audio, offline, all future updates.</p>
          <AppButton to="/pricing" variant="primary" class="mt-4" icon-right="arrow-right">See what's included</AppButton>
        </AppCard>

        <AppCard padding="lg">
          <p class="eyebrow">Pass guarantee</p>
          <p class="tabular display mt-1.5 text-[32px]">+$20</p>
          <p class="mt-3.5 text-[13.5px] leading-relaxed text-ink-2">Full refund of both payments on proof of a failed attempt within 90 days, after five full-length mocks.</p>
        </AppCard>
      </div>
    </section>

    <!-- Reviews -->
    <section v-if="approved.length" class="border-y border-line bg-paper">
      <div class="safe-px mx-auto grid max-w-6xl gap-8 py-16">
        <header class="flex items-end justify-between gap-4">
          <div class="grid gap-2.5">
            <p class="eyebrow">Reviews</p>
            <h2 class="display text-[30px]">From candidates</h2>
          </div>
          <NuxtLink to="/reviews" class="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent">
            All reviews <Icon name="arrow-right" :size="15" />
          </NuxtLink>
        </header>

        <div class="grid gap-4 md:grid-cols-3">
          <article v-for="r in approved" :key="r.id" class="grid gap-2.5 rounded-card border border-line bg-surface p-5">
            <span class="inline-flex gap-0.5 text-warn">
              <Icon v-for="n in 5" :key="n" :name="n <= r.rating ? 'star-filled' : 'star'" :size="15" :class="n <= r.rating ? '' : 'text-line-strong'" />
            </span>
            <p class="line-clamp-5 text-[14.5px] leading-relaxed text-ink-2">{{ r.body }}</p>
            <p class="text-[11.5px] text-muted">Candidate<template v-if="r.jurisdiction"> · {{ r.jurisdiction }}</template></p>
          </article>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section class="safe-px mx-auto grid max-w-3xl gap-6 py-16 md:py-24">
      <header class="grid gap-2.5">
        <p class="eyebrow">FAQ</p>
        <h2 class="display text-[30px]">Questions we get</h2>
      </header>

      <div class="grid gap-2">
        <article v-for="(f, i) in faq" :key="f.q" class="overflow-hidden rounded-card border border-line bg-surface">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-2"
            :aria-expanded="openFaq === i"
            @click="openFaq = openFaq === i ? null : i"
          >
            <span class="flex-1 text-[15px] font-medium">{{ f.q }}</span>
            <Icon name="chevron-down" :size="17" class="shrink-0 text-muted transition-transform duration-200 ease-standard" :class="openFaq === i ? 'rotate-180' : ''" />
          </button>
          <p v-if="openFaq === i" class="px-5 pb-5 text-[14.5px] leading-relaxed text-ink-2">{{ f.a }}</p>
        </article>
      </div>
    </section>

    <!-- Final CTA. A solid slab, not a brand-coloured one: the last thing you see is the product's voice. -->
    <section class="safe-px mx-auto max-w-6xl pb-10">
      <div class="grid items-center gap-6 rounded-panel bg-action p-8 text-action-ink md:grid-cols-[1fr_auto] md:p-12">
        <div class="grid gap-2.5">
          <h2 class="display text-[28px] md:text-[36px]">Failed the state portion? That's the half nobody prepared you for.</h2>
          <p class="text-[15px] leading-relaxed opacity-70">Start with 20 free questions in your state. Every one comes with its citation.</p>
        </div>
        <AppButton
          :to="auth.signedIn.value ? '/app' : '/signin'"
          size="lg"
          class="!border-transparent !bg-bg !text-ink hover:!bg-surface-2"
          icon-right="arrow-right"
        >{{ auth.signedIn.value ? 'Open the app' : 'Start free' }}</AppButton>
      </div>
    </section>
  </div>
</template>
