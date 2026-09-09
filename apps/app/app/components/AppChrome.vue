<script setup lang="ts">
import { JURISDICTIONS } from "@rep/schema";
import { pushToast } from "./Toast.vue";
/**
 * The global overlays for the signed-in app: the navigation panel, the state picker it hands off
 * to, and toasts. Mounted once per layout so every screen shares one instance.
 *
 * `open` / `statePicker` are bound as top-level refs so the template unwraps them. Passing
 * `panel.statePicker.value` was a Vue footgun (nested refs vs `.value` in templates).
 */
const { open, statePicker, hide, pickState } = useAppPanel();
const studyState = useStudyState();
const entitlement = useEntitlement();

const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);

async function chooseState(code: string) {
  const home = entitlement.profile.value?.home_jurisdiction;
  if (!entitlement.isComplete.value && home && home !== code) {
    pushToast("Free accounts stay in one state. Complete unlocks the rest.", "warn");
    statePicker.value = false;
    return;
  }
  statePicker.value = false;
  await entitlement.setHomeJurisdiction(code);
  await studyState.set({ jurisdiction: code });
  pushToast(`Studying ${JURISDICTIONS[code as keyof typeof JURISDICTIONS] ?? code}`, "ok");
}
</script>
<template>
  <AppPanel :open="open" @close="hide()" @change-state="pickState()" />
  <StatePicker
    :open="statePicker"
    :current="jur"
    @close="statePicker = false"
    @select="chooseState"
  />
  <Toast />
</template>
