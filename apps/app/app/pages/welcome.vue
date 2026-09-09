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
  <div class="safe-px mx-auto flex w-full max-w-lg flex-1 flex-col">
    <div class="flex items-center justify-between pt-6">
      <!-- linked: this is the only chrome on the page, so it is the only way back to the site -->
      <NuxtLink to="/" aria-label="CitePass home" class="tap inline-flex items-center rounded-lg"><BrandMark :size="30" wordmark /></NuxtLink>
      <div class="flex items-center gap-3">
        <NuxtLink to="/" class="tap inline-flex items-center px-2 text-[13.5px] font-medium text-ink-2 hover:text-ink">Home</NuxtLink>
        <NuxtLink to="/signin" class="tap inline-flex items-center px-2 text-[13.5px] font-medium text-accent">Sign in</NuxtLink>
      </div>
    </div>

    <div
      ref="track"
      class="no-scrollbar -mx-4 mt-5 flex flex-1 snap-x snap-mandatory overflow-x-auto"
      aria-roledescription="carousel"
      @scroll.passive="onScroll"
    >
      <section
        v-for="(s, n) in slides"
        :key="s.kind"
        class="flex w-full shrink-0 snap-center flex-col justify-center gap-7 px-4 py-6"
        :aria-hidden="n !== i"
        :aria-label="`${n + 1} of ${slides.length}`"
      >
        <div class="grid place-items-center rounded-panel border border-line bg-paper p-6">
          <OnboardingArt :kind="s.kind" :size="220" />
        </div>
        <div class="grid gap-2.5">
          <p class="eyebrow">{{ s.eyebrow }}</p>
          <h1 class="display text-[30px]">{{ s.title }}</h1>
          <p class="text-[16.5px] leading-relaxed text-ink-2">{{ s.body }}</p>
        </div>
      </section>
    </div>

    <div class="grid gap-4 pb-6">
      <div class="flex justify-center gap-1" role="tablist" aria-label="Slides">
        <button
          v-for="(s, n) in slides"
          :key="s.kind"
          type="button"
          role="tab"
          :aria-selected="n === i"
          :aria-label="`Slide ${n + 1}`"
          class="tap grid place-items-center"
          @click="go(n)"
        >
          <span
            class="block h-1.5 rounded-pill transition-all duration-300 ease-emphasized"
            :class="n === i ? 'w-7 bg-accent' : 'w-1.5 bg-line-strong'"
          />
        </button>
      </div>

      <AppButton v-if="i < slides.length - 1" variant="primary" size="lg" block icon-right="arrow-right" @click="go(i + 1)">Next</AppButton>
      <AppButton v-else to="/signin" variant="primary" size="lg" block icon-right="arrow-right">Get started — it's free</AppButton>

      <p class="text-center text-[12px] leading-relaxed text-muted">
        20 free questions in your state, every one with its citation. No card. $59 once for everything.
        <NuxtLink to="/" class="ml-1 font-semibold text-ink-2 underline-offset-4 hover:text-ink hover:underline">Back to the site</NuxtLink>
      </p>
    </div>
  </div>
</template>
