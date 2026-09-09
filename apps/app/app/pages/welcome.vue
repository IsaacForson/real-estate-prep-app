<script setup lang="ts">
/**
 * Onboarding carousel (mobile first, fine on web): three promises → Get started → sign in.
 * Signed-in users skip straight to the app.
 */
definePageMeta({ layout: "bare" });
useHead({ title: "Welcome" });
const auth = useAuth();
watch(() => [auth.ready.value, auth.signedIn.value], ([ready, signedIn]) => { if (ready && signedIn) navigateTo("/app", { replace: true }); }, { immediate: true });

const slides = [
  { kind: "citation" as const, eyebrow: "Every answer", title: "Cites the statute behind it.", body: "Not “because the book says so”. The section of law, quoted verbatim, with a link to the official text." },
  { kind: "states" as const, eyebrow: "All 50 states + DC", title: "The state portion, finally covered.", body: "Both national banks, routed to your state's exam vendor, plus your state's own laws — the half nobody else prepares you for." },
  { kind: "readiness" as const, eyebrow: "Honest readiness", title: "Know when you're ready. Really.", body: "A predicted score with a range, computed from your answers only. When it says you'll pass, you'll pass." },
];
const i = ref(0);
const track = ref<HTMLElement | null>(null);
function onScroll() { const el = track.value; if (!el) return; i.value = Math.round(el.scrollLeft / el.clientWidth); }
function go(n: number) { const el = track.value; if (!el) return; el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" }); }
</script>
<template>
  <div class="flex-1 flex flex-col max-w-lg mx-auto w-full safe-px">
    <div class="pt-6 flex items-center justify-between">
      <BrandMark :size="30" wordmark />
      <NuxtLink to="/signin" class="tap inline-flex items-center px-2 text-sm font-medium text-accent">Sign in</NuxtLink>
    </div>
    <div ref="track" class="flex-1 flex snap-x snap-mandatory overflow-x-auto no-scrollbar -mx-4 mt-4" @scroll.passive="onScroll" aria-roledescription="carousel">
      <section v-for="(s, n) in slides" :key="s.kind" class="snap-center shrink-0 w-full px-4 flex flex-col justify-center gap-6 py-6" :aria-hidden="n !== i" :aria-label="`${n + 1} of ${slides.length}`">
        <div class="rounded-[var(--radius-lg)] bg-paper border border-line p-6"><OnboardingArt :kind="s.kind" :size="220" /></div>
        <div class="grid gap-2">
          <p class="eyebrow text-accent">{{ s.eyebrow }}</p>
          <h1 class="text-3xl display">{{ s.title }}</h1>
          <p class="text-ink-2 text-[17px] leading-relaxed">{{ s.body }}</p>
        </div>
      </section>
    </div>
    <div class="pb-6 grid gap-4">
      <div class="flex justify-center gap-2" role="tablist" aria-label="Slides">
        <button v-for="(s, n) in slides" :key="s.kind" type="button" role="tab" :aria-selected="n === i" :aria-label="`Slide ${n + 1}`" class="tap grid place-items-center" @click="go(n)">
          <span class="block h-2 rounded-pill transition-all duration-300" :class="n === i ? 'w-6 bg-accent' : 'w-2 bg-line-strong'" />
        </button>
      </div>
      <AppButton v-if="i < slides.length - 1" variant="primary" size="lg" block icon-right="arrow-right" @click="go(i + 1)">Next</AppButton>
      <AppButton v-else to="/signin" variant="primary" size="lg" block icon-right="arrow-right">Get started — it's free</AppButton>
      <p class="text-center text-xs text-muted">40 free questions in your state, every one with its citation. No card. $59 once for everything.</p>
    </div>
  </div>
</template>
