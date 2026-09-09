<script setup lang="ts">
import type { IconName } from "./Icon.vue";
/**
 * Settings-style row: icon, label + detail, trailing value/chevron. Becomes a link with `to`, a
 * button when a click listener is attached (attrs fall through to the root), otherwise static.
 */
defineProps<{ icon?: IconName; label: string; detail?: string; value?: string; to?: string; chevron?: boolean; danger?: boolean }>();
const attrs = useAttrs();
const interactive = computed(() => !!attrs.onClick);
</script>
<template>
  <component
    :is="to ? 'NuxtLink' : (interactive ? 'button' : 'div')" :to="to" :type="!to && interactive ? 'button' : undefined"
    class="w-full flex items-center gap-3 px-4 min-h-14 text-left border-b border-line last:border-b-0 transition-colors"
    :class="[(to || interactive) ? 'hover:bg-surface-2 active:bg-surface-2' : '', danger ? 'text-danger' : 'text-ink']"
  >
    <span v-if="icon" class="grid place-items-center size-8 rounded-lg shrink-0" :class="danger ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-ink-2'"><Icon :name="icon" :size="18" /></span>
    <span class="flex-1 min-w-0 py-2.5">
      <span class="block text-[15px] font-medium leading-snug truncate">{{ label }}</span>
      <span v-if="detail" class="block text-[13px] text-muted leading-snug">{{ detail }}</span>
    </span>
    <span v-if="value" class="text-sm text-muted truncate max-w-[45%]">{{ value }}</span>
    <slot name="trailing" />
    <Icon v-if="chevron || to || interactive" name="chevron-right" :size="18" class="text-muted shrink-0" />
  </component>
</template>
