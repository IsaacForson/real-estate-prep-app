<script setup lang="ts">
/**
 * Fixed banner shown for the whole time an admin is viewing the app as somebody else.
 *
 * It is deliberately loud and impossible to dismiss. Everything done in this state is recorded
 * against the learner's account, so the one thing that must never happen is an admin forgetting
 * whose app they are looking at.
 */
const imp = useImpersonation();

/**
 * The server revokes the shadow session at `expiresAt` regardless. Counting down means the admin
 * sees it coming instead of watching the app start failing for no visible reason, and we hand the
 * admin session back automatically at zero rather than leaving them stranded as a dead user.
 */
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

const minutesLeft = computed(() => {
  const exp = imp.state.value?.expiresAt;
  if (!exp) return null;
  return Math.max(0, Math.ceil((exp - now.value) / 60_000));
});

onMounted(() => {
  imp.restore();
  timer = setInterval(() => {
    now.value = Date.now();
    const exp = imp.state.value?.expiresAt;
    if (imp.active.value && exp && exp <= now.value && !imp.busy.value) void imp.stop();
  }, 15_000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>
<template>
  <div
    v-if="imp.active.value && imp.state.value"
    class="fixed inset-x-0 top-0 z-[100] border-b-2 border-warn bg-warn-soft text-ink print:hidden"
    role="status"
  >
    <div class="safe-px mx-auto flex max-w-5xl items-center gap-3 py-2">
      <Icon name="eye" :size="17" class="shrink-0 text-warn" />
      <p class="m-0 min-w-0 flex-1 truncate text-[13px] font-bold">
        Viewing as <span class="font-extrabold">{{ imp.state.value.target.email }}</span>
        <span class="hidden font-medium text-ink-2 sm:inline"> — actions are recorded against their account</span>
      </p>
      <span v-if="minutesLeft != null" class="tabular shrink-0 text-[12px] font-bold text-ink-2">
        {{ minutesLeft }}m left
      </span>
      <AppButton variant="secondary" size="xs" :loading="imp.busy.value" @click="imp.stop()">Stop</AppButton>
    </div>
  </div>
  <!-- push the app down so a sticky header does not hide under the bar -->
  <div v-if="imp.active.value" class="h-10" aria-hidden="true" />
</template>
