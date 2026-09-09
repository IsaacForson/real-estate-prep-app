<script setup lang="ts">
/**
 * Route-aware TopBar for the public routes inside the native build (pricing, help, legal, state
 * briefs). The signed-in app uses AppShellHeader instead — `/app/**` never reaches this component.
 */
const route = useRoute();
const titles: Array<[RegExp, string]> = [
  [/^\/pricing/, "Complete"],
  [/^\/help\/contact/, "Contact us"],
  [/^\/help/, "Help Center"],
  [/^\/reviews/, "Reviews"],
  [/^\/methodology/, "Methodology"],
  [/^\/legal/, "Legal"],
  [/^\/states/, "Exam brief"],
];
const title = computed(() => titles.find(([re]) => re.test(route.path))?.[1] ?? "");
/**
 * Section roots reachable as an independent destination have nowhere to go back to; their children
 * do. `/pricing` is excluded: inside the native app it is only ever reached by tapping through from
 * somewhere (Home, the menu, "Unlock Complete"), never typed directly, so it always has a back step.
 */
const isRoot = computed(() => /^\/(help|reviews|methodology|legal|states)\/?$/.test(route.path));
</script>
<template>
  <TopBar :title="title" :back="!isRoot"><slot /></TopBar>
</template>
