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
  <div class="safe-px anim-fade-up mx-auto grid max-w-5xl gap-8 py-8 md:py-14">
    <header class="grid max-w-2xl gap-3">
      <p class="eyebrow">Reviews</p>
      <h1 class="display text-[32px] md:text-[42px]">What candidates say</h1>
      <p class="text-[15px] leading-relaxed text-ink-2">
        Every review is from a signed-in account and shown as written. We approve for abuse, not for
        tone — a 2-star review stays a 2-star review.
      </p>
    </header>

    <div class="grid items-start gap-6 md:grid-cols-[290px_1fr]">
      <div class="grid gap-4 md:sticky md:top-6">
        <AppCard v-if="list.length">
          <div class="flex items-end gap-3">
            <span class="display tabular text-[48px]">{{ avg.toFixed(1) }}</span>
            <span class="pb-2 text-[13px] text-muted">of 5 · {{ list.length }} review{{ list.length === 1 ? '' : 's' }}</span>
          </div>
          <ul class="mt-3.5 grid gap-1.5">
            <li v-for="d in dist" :key="d.n" class="tabular flex items-center gap-2 text-[11.5px] text-muted">
              <span class="w-3">{{ d.n }}</span>
              <Icon name="star-filled" :size="11" class="text-warn" />
              <span class="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-3">
                <span class="block h-full rounded-pill bg-warn" :style="{ width: (list.length ? (100 * d.c) / list.length : 0) + '%' }" />
              </span>
              <span class="w-6 text-right">{{ d.c }}</span>
            </li>
          </ul>
        </AppCard>

        <AppCard title="Write a review">
          <form v-if="auth.signedIn.value" class="grid gap-3" @submit.prevent="submit">
            <div class="flex gap-1" role="radiogroup" aria-label="Rating">
              <button
                v-for="n in 5"
                :key="n"
                type="button"
                role="radio"
                :aria-checked="rating === n"
                :aria-label="`${n} star${n > 1 ? 's' : ''}`"
                class="tap grid place-items-center rounded-lg transition-transform duration-150 ease-emphasized active:scale-95"
                :class="n <= rating ? 'text-warn' : 'text-line-strong'"
                @click="rating = n"
              ><Icon :name="n <= rating ? 'star-filled' : 'star'" :size="26" /></button>
            </div>
            <AppInput
              v-model="body"
              multiline
              :rows="4"
              placeholder="Which state, what helped, what didn't."
              :maxlength="800"
              :error="err"
              aria-label="Review"
            />
            <AppButton type="submit" variant="primary" :loading="busy">Submit</AppButton>
            <p class="text-[12px] leading-relaxed text-muted">Shown with your state after approval; never your email.</p>
          </form>
          <div v-else class="grid gap-3">
            <p class="text-[13.5px] leading-relaxed text-muted">Sign in to leave a review. Only accounts that have studied can post.</p>
            <AppButton to="/signin?next=/reviews" variant="secondary" size="sm" class="justify-self-start">Sign in</AppButton>
          </div>
        </AppCard>
      </div>

      <section class="grid gap-3">
        <EmptyState
          v-if="!list.length"
          icon="star"
          title="No approved reviews yet"
          body="Reviews appear here as candidates post them and we approve them."
        />
        <article v-for="r in list" :key="r.id" class="grid gap-2.5 rounded-card border border-line bg-surface p-4 sm:p-5">
          <div class="flex items-center gap-2.5">
            <span class="inline-flex text-warn" :aria-label="`${r.rating} out of 5`">
              <Icon v-for="n in 5" :key="n" :name="n <= r.rating ? 'star-filled' : 'star'" :size="15" :class="n <= r.rating ? '' : 'text-line-strong'" />
            </span>
            <span class="text-[11.5px] text-muted">
              {{ r.jurisdiction ?? '' }}<template v-if="r.jurisdiction"> · </template>{{ fmt(r.created_at) }}
            </span>
          </div>
          <p class="whitespace-pre-line text-[14.5px] leading-relaxed text-ink-2">{{ r.body }}</p>
        </article>
      </section>
    </div>
  </div>
</template>
