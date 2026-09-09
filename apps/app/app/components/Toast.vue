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
import type { IconName } from "./Icon.vue";
/** Info uses the solid fill so a toast never competes with a semantic colour that means something. */
const tone: Record<ToastItem["tone"], string> = {
  info: "bg-action text-action-ink",
  ok: "bg-ok text-white",
  warn: "bg-warn text-white",
  danger: "bg-danger text-white",
};
const glyph: Record<ToastItem["tone"], IconName> = { info: "info", ok: "check-circle", warn: "alert", danger: "x-circle" };
</script>
<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
      style="bottom: calc(env(safe-area-inset-bottom) + 76px)"
      aria-live="polite"
      aria-atomic="false"
    >
      <TransitionGroup
        enter-active-class="transition duration-200 ease-emphasized"
        enter-from-class="opacity-0 translate-y-2 scale-[0.98]"
        leave-active-class="transition duration-150 ease-standard"
        leave-to-class="opacity-0 scale-[0.98]"
      >
        <div
          v-for="t in items"
          :key="t.id"
          role="status"
          class="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-card px-3.5 py-3 text-[13.5px] font-medium shadow-float sm:w-auto"
          :class="tone[t.tone]"
        >
          <Icon :name="glyph[t.tone]" :size="17" class="mt-px opacity-90" />
          <span class="flex-1 leading-snug">{{ t.text }}</span>
          <button type="button" class="-mr-0.5 opacity-60 transition-opacity hover:opacity-100" aria-label="Dismiss" @click="dismissToast(t.id)">
            <Icon name="x" :size="15" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
