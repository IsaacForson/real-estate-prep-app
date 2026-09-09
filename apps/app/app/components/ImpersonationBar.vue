<script setup lang="ts">
/**
 * Fixed banner shown for the whole time an admin is viewing the app as somebody else.
 *
 * It is deliberately loud and impossible to dismiss. Everything done in this state is recorded
 * against the learner's account, so the one thing that must never happen is an admin forgetting
 * whose app they are looking at.
 */
const imp = useImpersonation();
onMounted(() => imp.restore());
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
      <AppButton variant="secondary" size="xs" :loading="imp.busy.value" @click="imp.stop()">Stop</AppButton>
    </div>
  </div>
  <!-- push the app down so a sticky header does not hide under the bar -->
  <div v-if="imp.active.value" class="h-10" aria-hidden="true" />
</template>
