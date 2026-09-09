<script lang="ts">
/**
 * Toast host + `pushToast()` helper. Import the helper from this file:
 *   import { pushToast } from "~/components/Toast.vue";
 * State lives in a module-level ref so any page can push without a composable.
 */
export interface ToastItem { id: number; text: string; tone: "info" | "ok" | "warn" | "danger"; timeout: number }
const items = ref<ToastItem[]>([]);
let seq = 0;
export function pushToast(text: string, tone: ToastItem["tone"] = "info", timeout = 3200) {
  const id = ++seq;
  items.value = [...items.value.slice(-2), { id, text, tone, timeout }];
  if (timeout > 0) setTimeout(() => dismissToast(id), timeout);
  return id;
}
export function dismissToast(id: number) { items.value = items.value.filter((t) => t.id !== id); }
</script>
<script setup lang="ts">
const tone = { info: "bg-ink text-bg", ok: "bg-ok text-white", warn: "bg-warn text-black", danger: "bg-danger text-white" };
</script>
<template>
  <Teleport to="body">
    <div class="fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none" style="bottom: calc(env(safe-area-inset-bottom) + 76px)" aria-live="polite" aria-atomic="false">
      <TransitionGroup enter-active-class="transition duration-200" enter-from-class="opacity-0 translate-y-2" leave-active-class="transition duration-150" leave-to-class="opacity-0">
        <div v-for="t in items" :key="t.id" role="status" class="pointer-events-auto max-w-sm w-full sm:w-auto rounded-xl px-4 py-3 text-sm font-medium shadow-float flex items-start gap-3" :class="tone[t.tone]">
          <span class="flex-1">{{ t.text }}</span>
          <button type="button" class="-mr-1 opacity-70 hover:opacity-100" aria-label="Dismiss" @click="dismissToast(t.id)"><Icon name="x" :size="16" /></button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
