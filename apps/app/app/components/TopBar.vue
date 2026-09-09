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
  <header class="sticky top-0 z-30 safe-pt" :class="transparent ? '' : 'bg-bg/85 backdrop-blur-md border-b border-line/70'">
    <div class="h-14 safe-px flex items-center gap-2 max-w-3xl mx-auto w-full">
      <button v-if="back" type="button" class="tap -ml-2 grid place-items-center rounded-full text-ink hover:bg-surface-2" aria-label="Back" @click="goBack(back)"><Icon name="chevron-left" :size="24" /></button>
      <div class="min-w-0 flex-1">
        <h1 v-if="title" class="text-[17px] font-semibold leading-tight truncate">{{ title }}</h1>
        <p v-if="context" class="text-xs text-muted truncate">{{ context }}</p>
      </div>
      <div class="flex items-center gap-1 -mr-1"><slot /></div>
    </div>
  </header>
</template>
