<script setup lang="ts">
useHead({ title: "Pricing — $59 once, every state, forever" });
</script>
<template>
  <div>
    <h1>One payment. Everything. Forever.</h1>
    <p class="muted">The use window for exam prep is four to six weeks. A subscription in a four-week product is a trap, and the reviews of every other app say so. We don't run one.</p>
    <div class="grid">
      <div class="card">
        <h2>Free</h2>
        <div style="font-size:28px;font-weight:700">$0</div>
        <ul>
          <li>40 questions in one state, with full explanations and statute citations</li>
          <li>One short mock</li>
          <li>No card, no trial that converts behind your back</li>
        </ul>
      </div>
      <div class="card" style="border-color: var(--accent)">
        <h2>Complete</h2>
        <div style="font-size:28px;font-weight:700">$59 <span class="muted" style="font-size:14px">one time · founding price $39 until 25 states are complete</span></div>
        <ul>
          <li>All 50 states + DC state portions — including states still in production, which arrive as they pass verification</li>
          <li>Both national banks, routed to your state's exam vendor</li>
          <li>Every question, every explanation, every citation, every mock. No daily limits. No upsells.</li>
          <li>Audio narration, offline study, spaced repetition, readiness score, coverage meter</li>
          <li>All future content and statute updates</li>
        </ul>
      </div>
      <div class="card">
        <h2>Pass guarantee</h2>
        <div style="font-size:28px;font-weight:700">+$20</div>
        <ul>
          <li>Full refund of both payments on proof of a failed attempt within 90 days of purchase</li>
          <li>Requires having completed at least 5 full-length mocks — so the guarantee also pushes you to do the thing that predicts passing</li>
        </ul>
      </div>
    </div>
    <p class="notice">Checkout is handled by our merchant of record (web) or the App Store / Google Play (mobile). Purchases are not shareable across accounts: your readiness score and schedule are computed from one person's answers, so a shared account degrades for everyone using it.</p>
    <p class="muted"><NuxtLink to="/legal/disclaimer">Trademark and affiliation disclaimer</NuxtLink></p>
  </div>
</template>
