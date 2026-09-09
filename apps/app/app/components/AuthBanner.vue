<script setup lang="ts">
/** Non-blocking notices from auth (expired sign-in, revoked session). Sits under the top bar. */
const auth = useAuth();
</script>
<template>
  <div v-if="auth.notice.value" class="flex items-center gap-3 px-4 py-2 text-sm border-b border-line" :class="auth.notice.value.kind === 'warn' ? 'bg-warn-soft text-ink' : 'bg-accent-soft text-ink'" role="status">
    <Icon :name="auth.notice.value.kind === 'warn' ? 'alert' : 'info'" :size="16" class="shrink-0" />
    <span class="flex-1">{{ auth.notice.value.text }}</span>
    <NuxtLink v-if="!auth.signedIn.value" to="/signin" class="font-medium text-accent">Sign in</NuxtLink>
    <button type="button" class="tap -mr-2 grid place-items-center text-muted" aria-label="Dismiss" @click="auth.dismissNotice()"><Icon name="x" :size="16" /></button>
  </div>
</template>
