<script setup lang="ts">
/** Route-aware TopBar for the app shell: title + jurisdiction context, back button off the tab roots. */
const route = useRoute();
const studyState = useStudyState();
const titles: Array<[RegExp, string]> = [
  [/^\/app\/?$/, "Home"],
  [/^\/app\/study\/?$/, "Study"],
  [/^\/app\/mocks\/?$/, "Mocks"],
  [/^\/app\/review/, "Review"],
  [/^\/app\/glossary/, "Glossary"],
  [/^\/app\/account/, "Account"],
  [/^\/pricing/, "Complete"],
  [/^\/help\/contact/, "Contact us"],
  [/^\/help/, "Help Center"],
  [/^\/reviews/, "Reviews"],
  [/^\/methodology/, "Methodology"],
  [/^\/legal/, "Legal"],
  [/^\/states/, "Exam brief"],
];
const title = computed(() => titles.find(([re]) => re.test(route.path))?.[1] ?? "");
const isTabRoot = computed(() => /^\/app\/?$|^\/app\/(study|mocks|review|account)\/?$/.test(route.path));
const context = computed(() => {
  const s = studyState.settings.value;
  const j = s?.jurisdiction;
  const scoped = route.path === "/app" || route.path.startsWith("/app/study") || route.path.startsWith("/app/mocks");
  return scoped ? (j ? `${j} · ${s?.licenseLevel ?? "salesperson"}` : "Choose your state") : undefined;
});
</script>
<template>
  <TopBar :title="title" :context="context" :back="!isTabRoot"><slot /></TopBar>
</template>
