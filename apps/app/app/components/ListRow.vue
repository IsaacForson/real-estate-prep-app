<script setup lang="ts">
import type { IconName } from "./Icon.vue";
/**
 * Settings-style row: icon, label + detail, trailing value/chevron. Becomes a link with `to`, a
 * button when a click listener is attached (attrs fall through to the root), otherwise static.
 * Designed to stack inside a `padding="none"` AppCard, so the divider is on the row itself.
 */
const props = defineProps<{ icon?: IconName; label: string; detail?: string; value?: string; to?: string; chevron?: boolean; danger?: boolean; button?: boolean }>();
const attrs = useAttrs();
/** `button` is the reliable switch — Vue 3.5 does not always expose `onClick` on `useAttrs()`. */
const interactive = computed(() => props.button || !!attrs.onClick);
</script>
<template>
  <component
    :is="to ? 'NuxtLink' : (interactive ? 'button' : 'div')"
    :to="to"
    :type="!to && interactive ? 'button' : undefined"
    class="flex min-h-14 w-full items-center gap-3 border-b border-line px-4 text-left transition-colors last:border-b-0"
    :class="[(to || interactive) ? 'hover:bg-surface-2 active:bg-surface-2' : '', danger ? 'text-danger' : 'text-ink']"
  >
    <span
      v-if="icon"
      class="grid size-8 shrink-0 place-items-center rounded-lg"
      :class="danger ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-ink-2'"
    ><Icon :name="icon" :size="17" /></span>

    <span class="min-w-0 flex-1 py-2.5">
      <span class="block truncate text-[15px] font-medium leading-snug">{{ label }}</span>
      <span v-if="detail" class="mt-0.5 block text-[13px] leading-snug text-muted">{{ detail }}</span>
    </span>

    <span v-if="value" class="max-w-[45%] truncate text-[13.5px] text-muted">{{ value }}</span>
    <slot name="trailing" />
    <Icon v-if="chevron || to || interactive" name="chevron-right" :size="17" class="shrink-0 text-muted" />
  </component>
</template>
