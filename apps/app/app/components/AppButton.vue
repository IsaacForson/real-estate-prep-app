<script setup lang="ts">
import type { IconName } from "./Icon.vue";
/**
 * The one button. Renders a <NuxtLink> when `to` is set, otherwise a <button>. 44px minimum
 * touch target on every size except `xs`; `block` stretches to the container.
 */
const props = withDefaults(defineProps<{
  variant?: "primary" | "secondary" | "ghost" | "danger" | "soft";
  size?: "xs" | "sm" | "md" | "lg";
  to?: string;
  href?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  block?: boolean;
  icon?: IconName;
  iconRight?: IconName;
  ariaLabel?: string;
}>(), { variant: "secondary", size: "md", type: "button" });

const classes = computed(() => {
  const base = "inline-flex items-center justify-center gap-2 font-medium select-none transition-[background-color,transform,opacity] duration-150 active:scale-[0.985] disabled:opacity-50 disabled:active:scale-100 whitespace-nowrap";
  const size = {
    xs: "h-8 px-3 text-[13px] rounded-lg",
    sm: "min-h-10 px-3.5 text-sm rounded-xl",
    md: "min-h-11 px-4 text-[15px] rounded-xl",
    lg: "min-h-13 px-5 text-base rounded-2xl",
  }[props.size];
  const variant = {
    primary: "bg-accent text-accent-ink hover:brightness-110 shadow-[inset_0_-1px_0_rgba(0,0,0,.12)]",
    secondary: "bg-surface text-ink border border-line hover:bg-surface-2",
    soft: "bg-accent-soft text-accent hover:brightness-[0.98]",
    ghost: "bg-transparent text-ink-2 hover:bg-surface-2",
    danger: "bg-danger-soft text-danger hover:brightness-[0.98]",
  }[props.variant];
  return [base, size, variant, props.block ? "w-full" : ""].join(" ");
});
const iconSize = computed(() => (props.size === "xs" ? 14 : props.size === "sm" ? 16 : 18));
</script>
<template>
  <NuxtLink v-if="to && !disabled" :to="to" :class="classes" :aria-label="ariaLabel">
    <Icon v-if="icon" :name="icon" :size="iconSize" />
    <slot />
    <Icon v-if="iconRight" :name="iconRight" :size="iconSize" />
  </NuxtLink>
  <a v-else-if="href && !disabled" :href="href" target="_blank" rel="noopener" :class="classes" :aria-label="ariaLabel">
    <Icon v-if="icon" :name="icon" :size="iconSize" />
    <slot />
    <Icon v-if="iconRight" :name="iconRight" :size="iconSize" />
  </a>
  <button v-else :type="type" :class="classes" :disabled="disabled || loading" :aria-busy="loading || undefined" :aria-label="ariaLabel">
    <span v-if="loading" class="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />
    <Icon v-else-if="icon" :name="icon" :size="iconSize" />
    <slot />
    <Icon v-if="iconRight && !loading" :name="iconRight" :size="iconSize" />
  </button>
</template>
