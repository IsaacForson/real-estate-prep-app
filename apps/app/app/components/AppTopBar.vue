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
/** Section roots have nowhere to go back to; their children do. */
const isRoot = computed(() => /^\/(pricing|help|reviews|methodology|legal|states)\/?$/.test(route.path));
</script>
<template>
  <TopBar :title="title" :back="!isRoot"><slot /></TopBar>
</template>
