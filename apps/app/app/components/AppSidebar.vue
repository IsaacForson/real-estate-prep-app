<script setup lang="ts">
import { JURISDICTIONS } from "@rep/schema";
/**
 * Persistent navigation for the signed-in app. Replaces the top bar and the overlay menu.
 * Narrow icon rail on a phone, labelled column from md up.
 */
const route = useRoute();
const panel = useAppPanel();
const studyState = useStudyState();
const entitlement = useEntitlement();
const content = useContent();
const study = useStudy();

const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);
const stateLocked = computed(() => !entitlement.isComplete.value && !!entitlement.profile.value?.home_jurisdiction);
const level = computed(() => studyState.settings.value?.licenseLevel ?? "salesperson");
const stateName = computed(() => (jur.value ? JURISDICTIONS[jur.value as keyof typeof JURISDICTIONS] ?? jur.value : "Choose state"));

const due = ref<number | null>(null);
const banks = computed(() => {
  const v = jur.value ? content.manifest.value?.states[jur.value]?.vendor : null;
  return [
    jur.value ? `state_${jur.value}` : null,
    v === "psi" ? "national_psi" : v === "pearsonvue" ? "national_pearsonvue" : null,
  ].filter((b): b is string => !!b);
});
async function loadDue() {
  try {
    let n = 0;
    for (const b of banks.value) n += (await study.pipelineFor(b)).dueNow;
    due.value = n;
  } catch { due.value = null; }
}
onMounted(() => { void content.load().then(() => loadDue()); });
watch(banks, () => { void loadDue(); });

const rows = computed(() => useAppNav({ due: due.value }));

function current(to: string) {
  if (to === "/app") return route.path === "/app";
  if (to === "/app/study") return route.path.startsWith("/app/study") || route.path.startsWith("/app/practice");
  return route.path === to || route.path.startsWith(`${to}/`);
}
</script>
<template>
  <aside class="safe-pt safe-pb sticky top-0 z-30 flex h-dvh w-[var(--app-sidebar)] shrink-0 flex-col border-r border-line bg-surface">
    <NuxtLink to="/app" class="flex items-center justify-center px-2 py-3 md:justify-start md:px-4 md:py-4" aria-label="CitePass home">
      <span class="md:hidden"><BrandMark :size="28" /></span>
      <span class="hidden md:inline-flex"><BrandMark :size="30" wordmark /></span>
    </NuxtLink>

    <button
      type="button"
      class="mx-2 flex min-h-11 items-center justify-center gap-2 rounded-card px-2 text-left text-ink-2 transition-colors hover:bg-surface-2 md:justify-start md:px-3"
      :aria-label="stateLocked ? `${stateName}, locked on the free tier` : `Study state, ${stateName}`"
      @click="panel.pickState()"
    >
      <Icon :name="stateLocked ? 'lock' : 'map'" :size="18" class="shrink-0 text-accent" />
      <span class="hidden min-w-0 md:block">
        <span class="block truncate text-[14px] font-extrabold leading-tight text-ink">{{ stateName }}</span>
        <span class="block truncate text-[12px] capitalize text-muted">{{ stateLocked ? "Free tier · one state" : level }}</span>
      </span>
    </button>

    <nav class="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2" aria-label="App">
      <NuxtLink
        v-for="r in rows"
        :key="r.to"
        :to="r.to"
        class="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-card px-1 py-1.5 text-center transition-colors md:flex-row md:justify-start md:gap-2.5 md:px-3 md:py-2 md:text-left"
        :class="current(r.to) ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'"
        :aria-current="current(r.to) ? 'page' : undefined"
      >
        <span class="relative grid size-6 shrink-0 place-items-center">
          <Icon :name="r.icon" :size="20" />
          <span v-if="r.count && !current(r.to)" class="absolute -top-1 -right-1 size-1.5 rounded-full bg-accent md:hidden" />
        </span>
        <span class="w-full text-[10px] font-bold leading-tight md:flex-1 md:truncate md:text-[14.5px]">{{ r.label }}</span>
        <Badge v-if="r.count" tone="accent" class="hidden md:inline-flex">{{ r.count }}</Badge>
      </NuxtLink>
    </nav>

    <div class="grid gap-1 px-2 pt-2 pb-2">
      <NuxtLink
        to="/help"
        class="flex min-h-11 items-center justify-center gap-2.5 rounded-card px-2 text-[13px] font-bold text-muted hover:bg-surface-2 hover:text-ink md:justify-start md:px-3"
      >
        <Icon name="help" :size="18" />
        <span class="hidden md:inline">Help</span>
      </NuxtLink>
      <NuxtLink
        v-if="!entitlement.isComplete.value"
        to="/pricing"
        class="flex min-h-11 items-center justify-center gap-2.5 rounded-card px-2 text-[13px] font-bold text-accent hover:bg-accent-soft md:justify-start md:px-3"
      >
        <Icon name="spark" :size="18" />
        <span class="hidden md:inline">Buy Complete</span>
      </NuxtLink>
    </div>
  </aside>
</template>
