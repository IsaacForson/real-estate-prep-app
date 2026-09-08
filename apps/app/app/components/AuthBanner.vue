<script setup lang="ts">
/** Small, non-blocking notices: expired sign-in, revoked session, re-verification email (SPEC §5.3). */
const auth = useAuth();
const sync = useSync();
</script>
<template>
  <div v-if="auth.notice.value" class="banner" :class="auth.notice.value.kind">
    <span>{{ auth.notice.value.text }}</span>
    <NuxtLink v-if="auth.notice.value.kind === 'warn' || !auth.signedIn.value" to="/account">Account</NuxtLink>
    <button class="x" aria-label="Dismiss" @click="auth.dismissNotice()">×</button>
  </div>
  <div v-if="sync.state.value.reverificationRequested" class="banner info">
    <span>We noticed unusual activity on your account and sent you an email to confirm it's you. Nothing is blocked.</span>
    <button class="x" aria-label="Dismiss" @click="sync.dismissReverification()">×</button>
  </div>
</template>
<style scoped>
.banner { display: flex; gap: 12px; align-items: center; padding: 8px 16px; font-size: 14px; border-bottom: 1px solid var(--border); background: var(--surface); }
.banner.warn { background: color-mix(in srgb, var(--yellow) 14%, var(--surface)); }
.banner.info { background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.banner span { flex: 1; }
.x { padding: 2px 8px; border: none; background: transparent; font-size: 18px; line-height: 1; }
</style>
