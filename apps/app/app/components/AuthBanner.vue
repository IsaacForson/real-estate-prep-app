<script setup lang="ts">
/** Non-blocking notices from auth (expired sign-in, revoked session). Sits under the top bar. */
const auth = useAuth();
</script>
<template>
  <div
    v-if="auth.notice.value"
    class="safe-px flex items-center gap-2.5 border-b py-2.5 text-[13.5px]"
    :class="auth.notice.value.kind === 'warn' ? 'border-warn/25 bg-warn-soft text-ink' : 'border-accent/20 bg-accent-soft text-ink'"
    role="status"
  >
    <Icon
      :name="auth.notice.value.kind === 'warn' ? 'alert' : 'info'"
      :size="16"
      class="shrink-0"
      :class="auth.notice.value.kind === 'warn' ? 'text-warn' : 'text-accent'"
    />
    <span class="flex-1 leading-snug">{{ auth.notice.value.text }}</span>
    <NuxtLink v-if="!auth.signedIn.value" to="/signin" class="shrink-0 font-medium text-accent underline underline-offset-2">Sign in</NuxtLink>
    <button type="button" class="tap -mr-2 grid place-items-center text-muted transition-colors hover:text-ink" aria-label="Dismiss" @click="auth.dismissNotice()">
      <Icon name="x" :size="15" />
    </button>
  </div>
</template>
