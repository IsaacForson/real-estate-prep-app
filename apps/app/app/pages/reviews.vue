<script setup lang="ts">
import { pushToast } from "~/components/Toast.vue";
/** Public approved reviews + submit form for signed-in users. */
useHead({ title: "Reviews" });
const auth = useAuth();
const reviews = useReviews();
const rating = ref(0);
const body = ref("");
const busy = ref(false);
const err = ref<string | null>(null);
const list = computed(() => reviews.approved.value ?? []);
onMounted(() => { void reviews.loadApproved(50); });
const avg = computed(() => (list.value.length ? list.value.reduce((a, r) => a + r.rating, 0) / list.value.length : 0));
const dist = computed(() => [5, 4, 3, 2, 1].map((n) => ({ n, c: list.value.filter((r) => r.rating === n).length })));
const fmt = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", year: "numeric" });
async function submit() {
  if (!rating.value) { err.value = "Pick a star rating."; return; }
  busy.value = true; err.value = null;
  const r = await reviews.submit(rating.value, body.value.trim());
  busy.value = false;
  if (!r.ok) { err.value = r.error ?? "Couldn't submit."; return; } rating.value = 0; body.value = ""; pushToast("Thank you. Reviews appear once approved.", "ok");
}
</script>
<template>
  <div class="max-w-5xl mx-auto safe-px py-6 md:py-12 grid gap-8 anim-fade-up">
    <header class="grid gap-2 max-w-2xl">
      <p class="eyebrow text-accent">Reviews</p>
      <h1 class="text-3xl md:text-4xl display">What candidates say</h1>
      <p class="text-ink-2">Every review is from a signed-in account and shown as written. We approve for abuse, not for tone — a 2-star review stays a 2-star review.</p>
    </header>

    <div class="grid md:grid-cols-[280px_1fr] gap-6 items-start">
      <div class="grid gap-4">
        <AppCard v-if="list.length">
          <div class="flex items-end gap-3"><span class="text-5xl display tabular">{{ avg.toFixed(1) }}</span><span class="text-sm text-muted pb-1.5">of 5 · {{ list.length }} review{{ list.length === 1 ? '' : 's' }}</span></div>
          <ul class="mt-3 grid gap-1.5">
            <li v-for="d in dist" :key="d.n" class="flex items-center gap-2 text-xs text-muted tabular"><span class="w-3">{{ d.n }}</span><Icon name="star-filled" :size="12" class="text-warn" /><span class="flex-1 h-1.5 rounded-pill bg-surface-3 overflow-hidden"><span class="block h-full bg-warn" :style="{ width: (list.length ? (100 * d.c) / list.length : 0) + '%' }" /></span><span class="w-6 text-right">{{ d.c }}</span></li>
          </ul>
        </AppCard>
        <AppCard title="Write a review">
          <form v-if="auth.signedIn.value" class="grid gap-3" @submit.prevent="submit">
            <div class="flex gap-1" role="radiogroup" aria-label="Rating">
              <button v-for="n in 5" :key="n" type="button" role="radio" :aria-checked="rating === n" :aria-label="`${n} star${n > 1 ? 's' : ''}`" class="tap grid place-items-center rounded-lg" :class="n <= rating ? 'text-warn' : 'text-line-strong'" @click="rating = n"><Icon :name="n <= rating ? 'star-filled' : 'star'" :size="28" /></button>
            </div>
            <AppInput v-model="body" multiline :rows="4" placeholder="Which state, what helped, what didn't." :maxlength="800" :error="err" aria-label="Review" />
            <AppButton type="submit" variant="primary" :loading="busy">Submit</AppButton>
            <p class="text-xs text-muted">Shown with your state after approval; never your email.</p>
          </form>
          <div v-else class="grid gap-3 text-sm text-muted"><p>Sign in to leave a review. Only accounts that have studied can post.</p><AppButton to="/signin?next=/reviews" variant="secondary" size="sm" class="justify-self-start">Sign in</AppButton></div>
        </AppCard>
      </div>

      <section class="grid gap-3">
        <EmptyState v-if="!list.length" icon="star" title="No approved reviews yet" body="Reviews appear here as candidates post them and we approve them." />
        <article v-for="r in list" :key="r.id" class="rounded-card bg-surface border border-line p-4 sm:p-5 grid gap-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex text-warn" :aria-label="`${r.rating} out of 5`"><Icon v-for="n in 5" :key="n" :name="n <= r.rating ? 'star-filled' : 'star'" :size="16" :class="n <= r.rating ? '' : 'text-line-strong'" /></span>
            <span class="text-xs text-muted">{{ r.jurisdiction ?? '' }}<template v-if="r.jurisdiction"> · </template>{{ fmt(r.created_at) }}</span>
          </div>
          <p class="text-[15px] text-ink-2 leading-relaxed whitespace-pre-line">{{ r.body }}</p>
        </article>
      </section>
    </div>
  </div>
</template>
