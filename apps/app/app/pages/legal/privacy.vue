<script setup lang="ts">
useHead({ title: "Privacy policy" });
</script>
<template>
  <LegalPage title="Privacy policy" updated="September 2026" intro="We collect what the product needs to work and nothing we would be embarrassed to explain.">
    <h2 class="!mt-0 text-ink">What we collect</h2>
    <ul>
      <li><strong>Account:</strong> your email address and sign-in timestamps.</li>
      <li><strong>Study data:</strong> your answers, sessions, mock results, spaced-repetition state, home state, exam date and settings. This is the product; it lives on our servers so nothing is lost when you change devices.</li>
      <li><strong>Devices:</strong> a per-device identifier (an app-scoped id on Android, the vendor identifier on iOS, a stable browser fingerprint on the web), platform and model, used to keep an account on one device at a time, to enforce the free tier and to detect account sharing.</li>
      <li><strong>Usage events:</strong> app opens, sessions started and finished, purchases, help searches and questions asked to the assistant, support tickets and reviews. Used for support, abuse prevention and improving content.</li>
      <li><strong>Purchases:</strong> purchase and entitlement records from Apple, Google or our merchant of record. We never see your card number.</li>
    </ul>
    <h2 class="text-ink">What we don't do</h2>
    <ul>
      <li>No advertising, no selling or sharing of personal data with third parties for their own purposes.</li>
      <li>No tracking across other apps or websites.</li>
    </ul>
    <h2 class="text-ink">Processors</h2>
    <p>Supabase (database, authentication and file storage), Apple App Store and Google Play (in-app purchases), RevenueCat (purchase validation), our merchant of record for web sales, and an AI inference provider for Help Center questions, which receives only the question text and our own help articles.</p>
    <h2 class="text-ink">Retention and deletion</h2>
    <p>Study data is kept while your account exists. You can delete your account and all associated data from Help → Contact; we complete deletion within 30 days, except purchase records we must keep for accounting.</p>
    <h2 class="text-ink">Your rights</h2>
    <p>You may request a copy of your data, correct it, or delete it at any time. Contact us from the Help Center. We are Forsare Ventures Ltd, Ghana.</p>
  </LegalPage>
</template>
