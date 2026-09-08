<script setup lang="ts">
const settings = useSettings();
const themes = ["system", "light", "dark"] as const;
function cycleTheme() { settings.set("theme", themes[(themes.indexOf(settings.theme) + 1) % themes.length]!); }
</script>
<template>
  <div>
    <nav class="top">
      <NuxtLink to="/"><strong>Exam Prep</strong></NuxtLink>
      <NuxtLink to="/study">Study</NuxtLink>
      <NuxtLink to="/study/review">Missed</NuxtLink>
      <NuxtLink to="/methodology">Method</NuxtLink>
      <NuxtLink to="/pricing">Pricing</NuxtLink>
      <span class="spacer" />
      <span v-if="settings.jurisdiction" class="pill">{{ settings.jurisdiction }}</span>
      <button @click="cycleTheme" :title="`Theme: ${settings.theme}`">{{ settings.theme === 'dark' ? '🌙' : settings.theme === 'light' ? '☀️' : '🌗' }}</button>
    </nav>
    <main class="container"><slot /></main>
  </div>
</template>
