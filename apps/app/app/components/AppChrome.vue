<script setup lang="ts">
import { JURISDICTIONS } from "@rep/schema";
import { pushToast } from "./Toast.vue";
/**
 * The global overlays for the signed-in app: the navigation panel, the state picker it hands off
 * to, and toasts. Mounted once per layout so every screen shares one instance.
 */
const panel = useAppPanel();
const studyState = useStudyState();
const entitlement = useEntitlement();

const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);

async function chooseState(code: string) {
  const home = entitlement.profile.value?.home_jurisdiction;
  if (!entitlement.isComplete.value && home && home !== code) {
    pushToast("Free accounts stay in one state. Complete unlocks the rest.", "warn");
    panel.statePicker.value = false;
    return;
  }
  panel.statePicker.value = false;
  await entitlement.setHomeJurisdiction(code);
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
