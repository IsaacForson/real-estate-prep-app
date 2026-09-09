<script setup lang="ts">
/**
 * Product rules an operator can change without a deploy (migration 0016 `app_settings`).
 *
 * The bar for putting something here is that support would plausibly need it changed on a Tuesday.
 * Everything else stays a constant in `_shared/limits.ts`, where it can be reasoned about
 * statically — a settings screen full of knobs nobody turns is just a way to break production.
 */
definePageMeta({ layout: "admin", ssr: false });
useHead({ title: "Settings · Admin" });

const { api, requireAdmin } = useAdmin();
const { confirm } = useAdminConfirm();
const action = useAdminAction();

const q = useAdminQuery(() => api.settings.get());
onMounted(() => { void requireAdmin(); });

const s = computed(() => q.data.value);
const maxDevices = computed(() => s.value?.effective.max_active_devices ?? 1);
const contentSync = computed(() => (s.value?.settings.content_sync ?? {}) as { epoch?: number; last_synced_at?: string | null });
const guarantee = computed(() => (s.value?.settings.guarantee ?? {}) as { window_days?: number; mocks_required?: number });
const windowDays = computed(() => s.value?.effective.guarantee_window_days ?? guarantee.value.window_days ?? 90);
const mocksRequired = computed(() => s.value?.effective.guarantee_mocks_required ?? guarantee.value.mocks_required ?? 5);
const announcement = computed(() => (s.value?.settings.announcement ?? {}) as { active?: boolean; message?: string | null; tone?: string; updated_at?: string | null });
const draftMessage = ref("");
const draftTone = ref<"info" | "warn" | "danger">("info");
watch(announcement, (a) => {
  draftMessage.value = a.message ?? "";
  draftTone.value = a.tone === "warn" || a.tone === "danger" ? a.tone : "info";
}, { immediate: true });

const deviceChoices = [
  { n: 1, label: "One device", hint: "Signing in anywhere signs the other device out. Strongest against sharing." },
  { n: 2, label: "Two devices", hint: "A phone and a laptop. A third sign-in retires the least recently used." },
  { n: 3, label: "Three devices", hint: "Phone, laptop, tablet. Comfortable, and harder to police." },
];

async function setDevices(n: number) {
  if (n === maxDevices.value) return;
  const lowering = n < maxDevices.value;
  const r = await confirm({
    title: n === 1 ? "Limit accounts to one device?" : `Allow ${n} devices per account?`,
    body: lowering
      ? "Accounts already over the new limit are not signed out immediately — the next sign-in on any of their devices retires the extras, oldest first."
      : "Existing accounts can add devices straight away. Nobody is signed out by this change.",
    confirmLabel: "Change rule",
    danger: false,
  });
  if (!r.ok) return;
  await action.run("devices", () => api.settings.set("device_policy", { max_active_devices: n }), `Accounts may now use ${n === 1 ? "one device" : `${n} devices`}.`, q.reload);
}

async function setGuarantee(patch: { window_days?: number; mocks_required?: number }) {
  const days = patch.window_days ?? windowDays.value;
  const mocks = patch.mocks_required ?? mocksRequired.value;
  if (!Number.isInteger(days) || days < 1 || days > 730) return;
  if (!Number.isInteger(mocks) || mocks < 0 || mocks > 50) return;
  if (days === windowDays.value && mocks === mocksRequired.value) return;
  await action.run("guarantee", () => api.settings.set("guarantee", { window_days: days, mocks_required: mocks }), "Guarantee terms updated.", q.reload);
}

async function publishAnnouncement(active: boolean) {
  const message = draftMessage.value.trim();
  if (active && !message) return;
  const r = await confirm({
    title: active ? "Publish this announcement?" : "Take the banner down?",
    body: active
      ? "Every install that is online will see it on the next load. People who dismissed an earlier one will see this one too."
      : "The text is kept so you can put it back without retyping.",
    confirmLabel: active ? "Publish" : "Hide banner",
  });
  if (!r.ok) return;
  await action.run(
    "announce",
    () => api.settings.set("announcement", { active, message: message || null, tone: draftTone.value }),
    active ? "Announcement is live." : "Banner hidden.",
    q.reload,
  );
}

async function resync() {
  const r = await confirm({
    title: "Force every install to refetch its questions?",
    body: "Bumps the content epoch. Each app compares it on next launch and clears its cached items, so the following session is served fresh. Safe to run any time; the only cost is one refetch per device.",
    confirmLabel: "Refetch content",
  });
  if (!r.ok) return;
  await action.run("resync", () => api.content.resync(), "Content epoch bumped — installs will refetch.", q.reload);
}
</script>
<template>
  <div class="space-y-5">
    <AdminPageHead
      title="Settings"
      subtitle="Rules that can change without a deploy. Everything here is audited."
    />

    <AdminState :loading="q.loading.value" :error="q.error.value" :empty="!s" @retry="q.reload">
      <template v-if="s">
        <AdminCard
          title="Devices per account"
          subtitle="How many devices may hold a live session at the same time"
        >
          <div class="grid gap-2">
            <button
              v-for="c in deviceChoices"
              :key="c.n"
              type="button"
              class="flex items-start gap-3 rounded-card border p-3.5 text-left transition-colors"
              :class="maxDevices === c.n ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong'"
              :aria-pressed="maxDevices === c.n"
              :disabled="!!action.busy.value"
              @click="setDevices(c.n)"
            >
              <span
                class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2"
                :class="maxDevices === c.n ? 'border-accent bg-accent text-white' : 'border-line-strong'"
              ><Icon v-if="maxDevices === c.n" name="check" :size="12" :stroke-width="3" /></span>
              <span class="min-w-0">
                <span class="block text-[14px] font-semibold">{{ c.label }}</span>
                <span class="block text-[12.5px] leading-relaxed text-muted">{{ c.hint }}</span>
              </span>
            </button>
          </div>
          <p class="m-0 mt-3 text-[11.5px] leading-relaxed text-muted">
            This is the rule the app was locked out by before: the old registry allowed three devices
            but froze a slot for seven days when one was removed, so a learner who signed in on a
            laptop could not use their phone. There is no cooldown at any setting now — a retired
            device can take its slot straight back.
          </p>
        </AdminCard>

        <AdminCard
          title="Content"
          :subtitle="`Epoch ${contentSync.epoch ?? 1}${contentSync.last_synced_at ? '' : ' · never forced'}`"
        >
          <template #actions>
            <AppButton variant="secondary" size="xs" icon="refresh" :loading="action.busy.value === 'resync'" @click="resync">
              Refetch on all devices
            </AppButton>
          </template>
          <p class="m-0 text-[13px] leading-relaxed text-ink-2">
            Questions are cached on each device so the app works offline. When a batch of items is
            corrected or republished, bump the epoch and every install drops its cache on next
            launch instead of serving the old wording until it happens to refetch.
          </p>
          <p v-if="contentSync.last_synced_at" class="m-0 mt-2 text-[12px] text-muted">
            Last forced <AdminTime :value="contentSync.last_synced_at" />.
          </p>
        </AdminCard>

        <AdminCard
          title="Pass guarantee"
          subtitle="The numbers the Refunds page judges every claim against"
        >
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid gap-1.5">
              <span class="text-[13px] font-semibold">Claim window (days)</span>
              <input
                type="number"
                min="1"
                max="730"
                class="h-11 rounded-card border border-line bg-surface px-3 text-[15px] tabular"
                :value="windowDays"
                :disabled="!!action.busy.value"
                @change="setGuarantee({ window_days: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="text-[12px] leading-relaxed text-muted">From the day they bought the add-on.</span>
            </label>
            <label class="grid gap-1.5">
              <span class="text-[13px] font-semibold">Mocks required</span>
              <input
                type="number"
                min="0"
                max="50"
                class="h-11 rounded-card border border-line bg-surface px-3 text-[15px] tabular"
                :value="mocksRequired"
                :disabled="!!action.busy.value"
                @change="setGuarantee({ mocks_required: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="text-[12px] leading-relaxed text-muted">Finished full-length mocks in the app before the attempt.</span>
            </label>
          </div>
        </AdminCard>

        <AdminCard
          title="Announcement"
          :subtitle="announcement.active ? 'Live on every install' : 'Draft — learners cannot see this'"
        >
          <label class="grid gap-1.5">
            <span class="text-[13px] font-semibold">Message</span>
            <textarea
              v-model="draftMessage"
              rows="3"
              maxlength="500"
              class="rounded-card border border-line bg-surface px-3 py-2.5 text-[14px] leading-relaxed"
              placeholder="e.g. Florida statute update in progress — state questions may be thin this week."
            />
          </label>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <span class="text-[13px] font-semibold">Tone</span>
            <button
              v-for="t in (['info', 'warn', 'danger'] as const)"
              :key="t"
              type="button"
              class="rounded-pill border px-3 py-1 text-[12.5px] font-bold capitalize"
              :class="draftTone === t ? 'border-accent bg-accent-soft' : 'border-line bg-surface'"
              @click="draftTone = t"
            >{{ t }}</button>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <AppButton
              variant="primary"
              size="sm"
              :loading="action.busy.value === 'announce'"
              :disabled="!draftMessage.trim()"
              @click="publishAnnouncement(true)"
            >{{ announcement.active ? "Update live banner" : "Publish" }}</AppButton>
            <AppButton
              v-if="announcement.active"
              variant="secondary"
              size="sm"
              :loading="action.busy.value === 'announce'"
              @click="publishAnnouncement(false)"
            >Hide banner</AppButton>
          </div>
          <p v-if="announcement.updated_at" class="m-0 mt-3 text-[12px] text-muted">
            Last changed <AdminTime :value="announcement.updated_at" />.
          </p>
        </AdminCard>

        <AdminCard title="Raw values" subtitle="what is stored, for when a number does not look right">
          <ul class="m-0 list-none p-0">
            <li v-for="row in s.rows" :key="row.key" class="border-b border-line py-2.5 last:border-b-0">
              <div class="flex flex-wrap items-baseline gap-2">
                <code class="font-mono text-[12px] font-semibold">{{ row.key }}</code>
                <span v-if="row.updated_at" class="text-[11.5px] text-muted">changed <AdminTime :value="row.updated_at" /></span>
              </div>
              <pre class="m-0 mt-1.5 overflow-x-auto rounded-md bg-surface-2 p-2.5 font-mono text-[11.5px] leading-relaxed">{{ JSON.stringify(row.value, null, 2) }}</pre>
            </li>
          </ul>
        </AdminCard>
      </template>
    </AdminState>
  </div>
</template>
