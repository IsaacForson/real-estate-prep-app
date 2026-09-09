<script setup lang="ts">
import type { IconName } from "./Icon.vue";
/**
 * The one button. Renders a <NuxtLink> when `to` is set, an <a> for `href`, otherwise a <button>.
 *
 * Buttons are pills with a solid bottom edge, and pressing one moves it down onto that edge so the
 * tap feels physical — see docs/DESIGN_SYSTEM.md. `primary` is the teal fill; `secondary` is a
 * bordered white pill with a fainter edge. The edge is drawn with box-shadow rather than a real
 * border so it never affects layout height.
 *
 * 46px minimum touch target on every size except `xs`; `block` stretches to the container.
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

/** Variants with a solid edge shift down by its depth when pressed; flat ones just tint. */
const RAISED: Record<string, string> = {
  primary: "bg-action text-action-ink shadow-[0_3px_0_0_var(--action-deep)] hover:brightness-[1.06]",
  secondary: "bg-surface text-ink border border-line shadow-[0_3px_0_0_var(--border)] hover:border-line-strong",
  danger: "bg-danger text-white shadow-[0_3px_0_0_var(--red-deep)] hover:brightness-[1.06]",
};

const classes = computed(() => {
  const base =
    "relative inline-flex items-center justify-center gap-2 font-bold select-none whitespace-nowrap rounded-pill " +
    "transition-[background-color,border-color,color,opacity,filter,transform,box-shadow] duration-150 ease-standard " +
    "disabled:opacity-45 disabled:pointer-events-none";
  const size = {
    xs: "h-8 px-3 text-[13px] gap-1.5",
    sm: "min-h-9 px-3.5 text-[13.5px]",
    md: "min-h-11 px-5 text-[15px]",
    lg: "min-h-[3.25rem] px-6 text-[16px]",
  }[props.size];
  const raised = RAISED[props.variant];
  const variant = raised ?? {
    soft: "bg-accent-soft text-accent hover:brightness-[0.97] active:scale-[0.98]",
    ghost: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink active:scale-[0.98]",
  }[props.variant as "soft" | "ghost"];
  // press: ride down onto the edge and flatten it
  const press = raised ? "active:translate-y-[3px] active:shadow-none" : "";
  return [base, size, variant, press, props.block ? "w-full" : ""].join(" ");
});
const iconSize = computed(() => (props.size === "xs" ? 14 : props.size === "sm" ? 16 : props.size === "lg" ? 19 : 18));
</script>
<template>
  <NuxtLink v-if="to && !disabled" :to="to" :class="classes" :aria-label="ariaLabel">
    <Icon v-if="icon" :name="icon" :size="iconSize" :stroke-width="2.1" />
    <slot />
    <Icon v-if="iconRight" :name="iconRight" :size="iconSize" :stroke-width="2.1" />
  </NuxtLink>
  <a v-else-if="href && !disabled" :href="href" target="_blank" rel="noopener" :class="classes" :aria-label="ariaLabel">
    <Icon v-if="icon" :name="icon" :size="iconSize" :stroke-width="2.1" />
    <slot />
    <Icon v-if="iconRight" :name="iconRight" :size="iconSize" :stroke-width="2.1" />
  </a>
  <button v-else :type="type" :class="classes" :disabled="disabled || loading" :aria-busy="loading || undefined" :aria-label="ariaLabel">
    <span
      v-if="loading"
      class="size-4 rounded-full border-2 border-current border-t-transparent animate-spin"
      aria-hidden="true"
    />
    <Icon v-else-if="icon" :name="icon" :size="iconSize" :stroke-width="2.1" />
    <slot />
    <Icon v-if="iconRight && !loading" :name="iconRight" :size="iconSize" :stroke-width="2.1" />
  </button>
</template>
