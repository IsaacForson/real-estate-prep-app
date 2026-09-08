<script setup lang="ts">
const settings = useSettings();
onMounted(() => {
  settings.restore();
  applyTheme();
});
watch(() => settings.theme, applyTheme);
function applyTheme() {
  if (!import.meta.client) return;
  const root = document.documentElement;
  if (settings.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", settings.theme);
}
</script>
<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
