<script setup lang="ts">
import type { IconName } from "./Icon.vue";
/**
 * Light / dark / auto, wherever a reader is when they decide the page is too bright.
 *
 * The preference is device-local (localStorage, applied by useBootstrap), so it is read on the
 * client only — rendering it during SSR would hydrate the wrong icon on every visit. Callers wrap
 * this in <ClientOnly> and reserve the space with a fallback.
 *
 * `cycle` is the compact one-button form for a nav bar; `tabs` is the explicit three-way choice for
 * a menu sheet or a settings screen, where there is room to name the options.
 */
withDefaults(defineProps<{ variant?: "cycle" | "tabs" }>(), { variant: "cycle" });

const settings = useSettings();
const THEMES = ["system", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];

const tabs = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const icon = computed<IconName>(() => (settings.theme === "dark" ? "moon" : settings.theme === "light" ? "sun" : "monitor"));
const nextTheme = computed<Theme>(() => THEMES[(THEMES.indexOf(settings.theme as Theme) + 1) % THEMES.length]!);
const label = computed(() => `Theme: ${settings.theme === "system" ? "auto" : settings.theme}. Switch to ${nextTheme.value === "system" ? "auto" : nextTheme.value}.`);
</script>
<template>
  <AppTabs
    v-if="variant === 'tabs'"
    :model-value="settings.theme"
    :tabs="tabs"
    aria-label="Theme"
    @update:model-value="(v) => settings.set('theme', v as Theme)"
  />
  <button
    v-else
    type="button"
    class="tap grid place-items-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
    :title="label"
    :aria-label="label"
    @click="settings.set('theme', nextTheme)"
  ><Icon :name="icon" :size="18" /></button>
</template>
