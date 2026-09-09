<script setup lang="ts">
import { JURISDICTIONS } from "@rep/schema";
import { pushToast } from "./Toast.vue";
/**
 * The global overlays for the signed-in app: the navigation panel, the state picker it hands off
 * to, and toasts. Mounted once per layout so every screen shares one instance.
 */
const panel = useAppPanel();
const studyState = useStudyState();

const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);

async function chooseState(code: string) {
  panel.statePicker.value = false;
  await studyState.set({ jurisdiction: code });
  pushToast(`Studying ${JURISDICTIONS[code as keyof typeof JURISDICTIONS] ?? code}`, "ok");
}
</script>
<template>
  <AppPanel :open="panel.open.value" @close="panel.hide()" @change-state="panel.pickState()" />
  <StatePicker
    :open="panel.statePicker.value"
    :current="jur"
    @close="panel.statePicker.value = false"
    @select="chooseState"
  />
  <Toast />
</template>
