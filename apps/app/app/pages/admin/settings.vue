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
