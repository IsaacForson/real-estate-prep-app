<script setup lang="ts">
/**
 * SPEC §6 free-tier notice: a quiet counter while questions remain, the pricing CTA when the 40
 * are used up. Renders nothing in static dev mode or for a Complete account.
 */
defineProps<{ variant?: "banner" | "block" }>();
const { applies, remaining, exhausted, total, state, load } = useFreeTier();
const auth = useAuth();
onMounted(() => { void load(); });
</script>
<template>
  <div v-if="applies && exhausted" class="card gate">
    <h2>You've used all {{ total }} free questions</h2>
    <p>Every one of them came with its explanation and citation — that is the whole free tier, honestly. <strong>Complete</strong> is $59 once, forever: every state, both national banks, every mock, no daily limits.</p>
    <div class="row">
      <NuxtLink class="btn primary" to="/pricing">See Complete — $59 once</NuxtLink>
      <NuxtLink v-if="!auth.signedIn.value" class="btn" to="/account">Sign in</NuxtLink>
    </div>
    <p v-if="!auth.signedIn.value" class="muted" style="margin-bottom:0">Already bought Complete? Sign in and this limit disappears.</p>
  </div>
  <p v-else-if="applies && variant !== 'block'" class="notice">
    Free tier: <strong>{{ remaining }}</strong> of {{ total }} questions left<template v-if="state.jurisdiction"> · locked to {{ state.jurisdiction }}</template> · one short mock.
    <NuxtLink to="/pricing">Complete unlocks everything for $59 once.</NuxtLink>
  </p>
</template>
<style scoped>
.gate { border-color: var(--accent); }
</style>
