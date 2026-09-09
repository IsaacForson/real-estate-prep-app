<script setup lang="ts">
/** Mobile top bar: optional back button, title + context line, trailing slot. Sits under the status bar. */
defineProps<{ title?: string; context?: string; back?: string | boolean; transparent?: boolean }>();
const router = useRouter();
function goBack(back: string | boolean | undefined) {
  if (typeof back === "string") return navigateTo(back);
  if (window.history.length > 1) router.back(); else navigateTo("/app");
}
</script>
<template>
  <header class="safe-pt sticky top-0 z-30" :class="transparent ? '' : 'border-b border-line bg-bg/85 backdrop-blur-xl'">
    <div class="safe-px mx-auto flex h-14 w-full max-w-3xl items-center gap-1.5">
      <button
        v-if="back"
        type="button"
        class="tap -ml-2.5 grid place-items-center rounded-full text-ink transition-colors hover:bg-surface-2"
        aria-label="Back"
        @click="goBack(back)"
      ><Icon name="chevron-left" :size="22" /></button>

      <div class="min-w-0 flex-1">
        <h1 v-if="title" class="truncate text-[17px] font-semibold leading-tight tracking-[-0.016em]">{{ title }}</h1>
        <p v-if="context" class="truncate text-[12px] leading-tight text-muted">{{ context }}</p>
      </div>

      <div class="-mr-1 flex items-center gap-1"><slot /></div>
    </div>
  </header>
</template>
