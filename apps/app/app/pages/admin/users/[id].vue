<script setup lang="ts">
import type { AdminEntitlement } from "~/composables/useAdmin";

definePageMeta({ layout: "admin", ssr: false });

const route = useRoute();
const id = computed(() => String(route.params.id ?? ""));
const { api, requireAdmin } = useAdmin();
const auth = useAuth();
const { confirm } = useAdminConfirm();
const action = useAdminAction();
const toast = useAdminToast();

const q = useAdminQuery(() => api.users.get(id.value));
watch(id, () => { void q.reload(); });
onMounted(() => { void requireAdmin(); });

const u = computed(() => q.data.value);
const email = computed(() => u.value?.auth?.email ?? null);
useHead({ title: computed(() => `${email.value ?? "User"} · Admin`) });

const disabled = computed(() => {
  const b = u.value?.auth?.banned_until;
  return !!(u.value?.profile?.disabled || (b && new Date(b).getTime() > Date.now()));
});
const isSelf = computed(() => auth.user.value?.id === id.value);
const PRODUCTS = ["complete", "pass_guarantee"];
const entState = (e: AdminEntitlement) => (e.revoked_at ? "revoked" : e.paused_until && new Date(e.paused_until).getTime() > Date.now() ? "paused" : "active");
const activeProducts = computed(() => new Set((u.value?.entitlements ?? []).filter((e) => entState(e) !== "revoked").map((e) => e.product)));
const grantable = computed(() => PRODUCTS.filter((p) => !activeProducts.value.has(p)));

type Tab = "events" | "tickets" | "reviews" | "coupons" | "sessions";
const tab = ref<Tab>("events");
const tabs: Array<{ v: Tab; label: string; count: () => number }> = [
  { v: "events", label: "Events", count: () => u.value?.events?.length ?? 0 },
  { v: "tickets", label: "Tickets", count: () => u.value?.tickets?.length ?? 0 },
  { v: "reviews", label: "Reviews", count: () => u.value?.reviews?.length ?? 0 },
  { v: "coupons", label: "Coupons", count: () => u.value?.coupons?.length ?? 0 },
  { v: "sessions", label: "Sessions", count: () => u.value?.sessions?.length ?? 0 },
];

// ── account actions ──
async function disable() {
  const r = await confirm({ title: `Disable ${email.value ?? "this user"}?`, body: "They are signed out everywhere and cannot sign in until re-enabled.", confirmLabel: "Disable", danger: true, reason: { label: "Reason", required: true, placeholder: "e.g. chargeback, abuse" } });
  if (!r.ok) return;
  await action.run("disable", () => api.users.disable(id.value, r.reason), "User disabled.", q.reload);
}
async function enable() {
  const r = await confirm({ title: `Re-enable ${email.value ?? "this user"}?`, confirmLabel: "Enable" });
  if (!r.ok) return;
  await action.run("enable", () => api.users.enable(id.value), "User enabled.", q.reload);
}
async function sendCode() {
  const r = await confirm({ title: "Send a sign-in code?", body: `Emails a 6-digit code to ${email.value ?? "the user"}.`, confirmLabel: "Send code" });
  if (!r.ok) return;
  await action.run("code", () => api.users.sendCode(id.value), "Sign-in code sent.");
}
async function toggleAdmin() {
  const making = !u.value?.profile?.is_admin;
  const r = await confirm({ title: making ? "Grant admin access?" : "Remove admin access?", body: making ? "They will see this console and every learner's data." : "They lose access to the console immediately.", confirmLabel: making ? "Make admin" : "Remove admin", danger: !making });
  if (!r.ok) return;
  await action.run("admin", () => api.users.setAdmin(id.value, making), making ? "Admin granted." : "Admin removed.", q.reload);
}
// ── entitlements ──
async function grant(product: string) {
  const r = await confirm({ title: `Grant “${product}”?`, confirmLabel: "Grant", reason: { label: "Note", placeholder: "why (shown in audit)" } });
  if (!r.ok) return;
  await action.run(`grant-${product}`, () => api.entitlements.grant(id.value, product, r.reason), `Granted ${product}.`, q.reload);
}
async function revoke(product: string) {
  const r = await confirm({ title: `Revoke “${product}”?`, body: "The learner drops back to the free tier.", confirmLabel: "Revoke", danger: true, reason: { label: "Reason", required: true } });
  if (!r.ok) return;
  await action.run(`revoke-${product}`, () => api.entitlements.revoke(id.value, product, r.reason), `Revoked ${product}.`, q.reload);
}
async function pause(product: string) {
  const r = await confirm({ title: `Pause “${product}”?`, body: "Access is suspended until the date you choose.", confirmLabel: "Pause", reason: { label: "Paused until", required: true, type: "date" } });
  if (!r.ok) return;
  await action.run(`pause-${product}`, () => api.entitlements.pause(id.value, product, new Date(r.reason).toISOString()), `Paused ${product}.`, q.reload);
}
async function resume(product: string) {
  await action.run(`resume-${product}`, () => api.entitlements.resume(id.value, product), `Resumed ${product}.`, q.reload);
}
// ── impersonation ──
const imp = useImpersonation();
async function openAsUser() {
  const r = await confirm({
    title: `Open the app as ${email.value ?? "this user"}?`,
    body: "You will be signed in as them until you press Stop. They stay signed in on their own device, and everything you do is recorded against their account and in the audit log.",
    confirmLabel: "Open as user",
  });
  if (!r.ok) return;
  const ok = await imp.start(id.value, () => api.users.impersonate(id.value));
  if (!ok) {
    const msg = imp.error.value ?? "Could not open the app as this user.";
    toast.push("error", msg);
  }
}

// ── refunds ──
const eligibility = ref<Awaited<ReturnType<typeof api.refunds.eligibility>> | null>(null);
watch(u, async (v) => {
  eligibility.value = null;
  if (v) { try { eligibility.value = await api.refunds.eligibility(id.value); } catch { /* non-fatal */ } }
}, { immediate: true });

async function fileRefund() {
  const r = await confirm({
    title: "File a refund request?",
    body: "It opens on the Refunds screen, where it can be approved in full or in part. Nothing is refunded and no access changes until it is approved there.",
    confirmLabel: "File request",
    reason: { label: "Reason", required: true, placeholder: "e.g. failed the state portion, guarantee claim" },
  });
  if (!r.ok) return;
  await action.run(
    "refund",
    () => api.refunds.create({
      user_id: id.value,
      kind: eligibility.value?.has_guarantee ? "guarantee" : "full",
      products: [...activeProducts.value],
      reason: r.reason,
      evidence: eligibility.value ? { eligibility_at_filing: eligibility.value } : {},
    }),
    "Refund request filed.",
  );
  await navigateTo("/admin/refunds");
}

// ── devices ──
async function removeDevice(deviceId: string, name: string | null | undefined) {
  const r = await confirm({ title: `Remove device ${name ?? adminFmt.short(deviceId)}?`, body: "The slot frees immediately; the learner must sign in again on that device.", confirmLabel: "Remove", danger: true });
  if (!r.ok) return;
  await action.run(`dev-${deviceId}`, () => api.users.removeDevice(id.value, deviceId), "Device removed.", q.reload);
}
</script>
<template>
  <div class="space-y-4">
    <nav class="text-[13px] text-muted" aria-label="Breadcrumb">
      <NuxtLink to="/admin/users" class="hover:text-ink">Users</NuxtLink>
      <span class="px-1">/</span>
      <span class="font-mono text-[11.5px]">{{ id }}</span>
    </nav>

    <AdminState :loading="q.loading.value" :error="q.error.value" :empty="!u" empty-text="User not found." @retry="q.reload">
      <template v-if="u">
        <!-- header: identity and the state badges that change what the actions below mean -->
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h1 class="m-0 flex flex-wrap items-center gap-2 text-[19px] font-semibold tracking-[-0.018em]">
              {{ email ?? "(no email)" }}
              <AdminBadge v-if="disabled" text="disabled" tone="danger" />
              <AdminBadge v-if="u.profile?.is_admin" text="admin" tone="accent" />
              <AdminBadge v-for="p in activeProducts" :key="p" :text="p" tone="ok" />
            </h1>
            <p class="m-0 mt-1 text-[13px] leading-relaxed text-muted">
              Joined <AdminTime :value="u.auth?.created_at ?? u.profile?.created_at" /> · last sign-in <AdminTime :value="u.auth?.last_sign_in_at" />
              <template v-if="u.profile?.home_jurisdiction"> · home state {{ u.profile.home_jurisdiction }}</template>
              <template v-if="u.profile?.exam_date"> · exam {{ adminFmt.day(u.profile.exam_date) }}</template>
              <template v-if="u.auth?.banned_until && disabled"> · banned until {{ adminFmt.abs(u.auth.banned_until) }}</template>
            </p>
            <p v-if="imp.error.value" class="m-0 mt-2 max-w-xl text-[13px] font-medium text-danger" role="alert">{{ imp.error.value }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <AppButton
              variant="secondary"
              size="sm"
              icon="eye"
              :loading="imp.busy.value"
              :disabled="isSelf || u.profile?.is_admin === true || disabled"
              :aria-label="u.profile?.is_admin ? 'Admins cannot be impersonated' : undefined"
              @click="openAsUser"
            >Open as user</AppButton>
            <AppButton variant="secondary" size="sm" :loading="action.busy.value === 'code'" @click="sendCode">Send sign-in code</AppButton>
            <AppButton
              variant="secondary"
              size="sm"
              :disabled="action.busy.value === 'admin' || isSelf"
              :aria-label="isSelf ? 'You cannot change your own admin flag' : undefined"
              @click="toggleAdmin"
            >{{ u.profile?.is_admin ? "Remove admin" : "Make admin" }}</AppButton>
            <AppButton v-if="disabled" variant="primary" size="sm" :loading="action.busy.value === 'enable'" @click="enable">Enable account</AppButton>
            <AppButton v-else variant="danger" size="sm" :disabled="action.busy.value === 'disable' || isSelf" @click="disable">Disable account</AppButton>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
          <AdminKpiTile label="Answers" :value="adminFmt.int(u.study?.answers)" />
          <AdminKpiTile label="Accuracy" :value="u.study?.accuracy == null ? '—' : u.study.accuracy <= 1 ? adminFmt.ratio(u.study.accuracy) : adminFmt.pct(u.study.accuracy)" />
          <AdminKpiTile label="Mocks" :value="adminFmt.int(u.study?.mocks)" />
          <AdminKpiTile label="Readiness" :value="u.study?.readiness == null ? '—' : u.study.readiness <= 1 ? adminFmt.ratio(u.study.readiness) : adminFmt.pct(u.study.readiness)" />
          <AdminKpiTile label="Free questions used" :value="`${adminFmt.int(u.free_tier?.questions_used)} / 20`" :tone="(u.free_tier?.questions_used ?? 0) >= 20 ? 'warn' : 'default'" />
          <AdminKpiTile label="Free mocks used" :value="`${adminFmt.int(u.free_tier?.mocks_used)} / 1`" />
        </div>

        <div class="grid gap-5 xl:grid-cols-2">
          <AdminCard title="Entitlements">
            <template #actions>
              <AppButton v-for="p in grantable" :key="p" variant="primary" size="xs" :disabled="!!action.busy.value" @click="grant(p)">Grant {{ p }}</AppButton>
            </template>
            <p v-if="!u.entitlements?.length" class="m-0 text-[13px] text-muted">Free tier — no entitlements.</p>
            <ul v-else class="m-0 list-none p-0">
              <li
                v-for="(e, i) in u.entitlements"
                :key="e.id ?? `${e.product}-${i}`"
                class="flex flex-wrap items-center gap-2 border-b border-line py-2.5 text-[13px] last:border-b-0"
              >
                <strong class="font-semibold">{{ e.product }}</strong>
                <AdminBadge :text="entState(e)" />
                <span class="text-[11.5px] text-muted">
                  <template v-if="e.source">{{ e.source }} · </template>granted <AdminTime :value="e.granted_at" />
                  <template v-if="e.paused_until && entState(e) === 'paused'"> · until {{ adminFmt.abs(e.paused_until) }}</template>
                  <template v-if="e.revoked_at"> · revoked <AdminTime :value="e.revoked_at" /></template>
                  <template v-if="e.note"> · {{ e.note }}</template>
                </span>
                <span class="ml-auto flex gap-1">
                  <template v-if="entState(e) === 'active'">
                    <AppButton variant="ghost" size="xs" :disabled="!!action.busy.value" @click="pause(e.product)">Pause</AppButton>
                    <AppButton variant="ghost" size="xs" class="!text-danger" :disabled="!!action.busy.value" @click="revoke(e.product)">Revoke</AppButton>
                  </template>
                  <template v-else-if="entState(e) === 'paused'">
                    <AppButton variant="secondary" size="xs" :disabled="!!action.busy.value" @click="resume(e.product)">Resume</AppButton>
                    <AppButton variant="ghost" size="xs" class="!text-danger" :disabled="!!action.busy.value" @click="revoke(e.product)">Revoke</AppButton>
                  </template>
                </span>
              </li>
            </ul>
          </AdminCard>

          <AdminCard title="Devices" :subtitle="`${u.devices?.length ?? 0} seen · one active at a time`">
            <p v-if="!u.devices?.length" class="m-0 text-[13px] text-muted">No devices registered.</p>
            <ul v-else class="m-0 list-none p-0">
              <li v-for="d in u.devices" :key="d.id" class="flex flex-wrap items-center gap-2 border-b border-line py-2.5 text-[13px] last:border-b-0">
                <span class="w-12 shrink-0 text-[11px] uppercase tracking-[0.04em] text-muted">{{ d.platform ?? "?" }}</span>
                <span class="font-medium">{{ d.name ?? adminFmt.short(d.id) }}</span>
                <AdminBadge v-if="d.has_live_session" text="live" tone="ok" />
                <AdminBadge v-if="d.removed_at" text="removed" tone="muted" />
                <span class="text-[11.5px] text-muted">seen <AdminTime :value="d.last_seen" /></span>
                <span v-if="d.device_hash" class="font-mono text-[11.5px] text-muted" :title="d.device_hash">{{ adminFmt.short(d.device_hash, 10) }}</span>
                <AppButton
                  v-if="!d.removed_at"
                  variant="ghost"
                  size="xs"
                  class="ml-auto !text-danger"
                  :disabled="!!action.busy.value"
                  @click="removeDevice(d.id, d.name)"
                >Sign out</AppButton>
              </li>
            </ul>
          </AdminCard>

          <!--
            The published guarantee conditions, checked rather than recited, so the operator can
            answer "are they entitled to this" without reading four tables. It reports facts; the
            score report is a human judgement and stays one.
          -->
          <AdminCard title="Refund &amp; guarantee" subtitle="pass guarantee conditions, SPEC §6">
            <template #actions>
              <AppButton variant="secondary" size="xs" :loading="action.busy.value === 'refund'" @click="fileRefund">File refund request</AppButton>
            </template>
            <p v-if="!eligibility" class="m-0 text-[13px] text-muted">Checking…</p>
            <template v-else>
              <ul class="m-0 list-none p-0">
                <li
                  v-for="c in [
                    { ok: eligibility.has_guarantee, label: 'Bought the pass guarantee', detail: eligibility.guarantee_granted_at ? adminFmt.abs(eligibility.guarantee_granted_at) : 'not purchased' },
                    { ok: eligibility.within_window, label: `Within the ${eligibility.window_days ?? 90}-day window`, detail: eligibility.days_since_guarantee == null ? '—' : `${eligibility.days_since_guarantee} days since purchase` },
                    { ok: eligibility.meets_mock_requirement, label: `Completed ${eligibility.mocks_required ?? 5} full mocks`, detail: `${eligibility.mocks_completed} completed` },
                    { ok: !eligibility.already_refunded, label: 'Not already refunded', detail: eligibility.already_refunded ? 'a refund is already on file' : 'no prior refund' },
                  ]"
                  :key="c.label"
                  class="flex items-center gap-2 border-b border-line py-2.5 text-[13px] last:border-b-0"
                >
                  <Icon :name="c.ok ? 'check-circle' : 'x-circle'" :size="16" :class="c.ok ? 'text-ok' : 'text-danger'" />
                  <span class="font-medium">{{ c.label }}</span>
                  <span class="ml-auto text-[11.5px] text-muted">{{ c.detail }}</span>
                </li>
              </ul>
              <p class="m-0 mt-3 text-[11.5px] leading-relaxed text-muted">
                Approving a refund revokes the listed entitlements here. Returning the money is a
                separate step in App Store Connect or Play Console — record the reference on the
                Refunds screen once it is done.
              </p>
            </template>
          </AdminCard>
        </div>

        <!-- history: underline tabs rather than a segmented control, because the counts vary a lot
             and a segmented control would jitter as they load -->
        <AdminCard flush>
          <div class="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-2" role="tablist">
            <button
              v-for="t in tabs"
              :key="t.v"
              type="button"
              role="tab"
              :aria-selected="tab === t.v"
              class="shrink-0 border-b-2 px-3 py-2.5 text-[13.5px] transition-colors"
              :class="tab === t.v ? 'border-b-accent font-semibold text-ink' : 'border-b-transparent text-muted hover:text-ink-2'"
              @click="tab = t.v"
            >
              {{ t.label }}
              <span class="tabular ml-1 rounded-pill bg-surface-2 px-1.5 text-[11px] text-muted">{{ t.count() }}</span>
            </button>
          </div>

          <div class="p-4">
            <template v-if="tab === 'events'">
              <p v-if="!u.events?.length" class="m-0 text-[13px] text-muted">No events recorded.</p>
              <AdminEventsTimeline v-else :events="u.events" />
            </template>

            <template v-else-if="tab === 'tickets'">
              <p v-if="!u.tickets?.length" class="m-0 text-[13px] text-muted">No support tickets.</p>
              <ul v-else class="m-0 list-none p-0">
                <li v-for="t in u.tickets" :key="t.id" class="flex flex-wrap items-center gap-2 border-b border-line py-2.5 text-[13px] last:border-b-0">
                  <NuxtLink :to="{ path: '/admin/support', query: { id: t.id } }" class="font-medium hover:text-accent">{{ t.subject }}</NuxtLink>
                  <AdminBadge :text="t.status" />
                  <span class="ml-auto text-[11.5px] text-muted"><AdminTime :value="t.updated_at ?? t.created_at" /></span>
                </li>
              </ul>
            </template>

            <template v-else-if="tab === 'reviews'">
              <p v-if="!u.reviews?.length" class="m-0 text-[13px] text-muted">No reviews.</p>
              <ul v-else class="m-0 list-none p-0">
                <li v-for="r in u.reviews" :key="r.id" class="border-b border-line py-2.5 text-[13px] last:border-b-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="inline-flex text-warn" :aria-label="`${r.rating} of 5`">
                      <Icon v-for="n in 5" :key="n" :name="n <= r.rating ? 'star-filled' : 'star'" :size="13" :class="n <= r.rating ? '' : 'text-line-strong'" />
                    </span>
                    <AdminBadge :text="r.status" />
                    <span class="ml-auto text-[11.5px] text-muted"><AdminTime :value="r.created_at" /></span>
                  </div>
                  <p class="m-0 mt-1.5 whitespace-pre-wrap leading-relaxed text-ink">{{ r.body }}</p>
                </li>
              </ul>
            </template>

            <template v-else-if="tab === 'coupons'">
              <p v-if="!u.coupons?.length" class="m-0 text-[13px] text-muted">No coupons redeemed.</p>
              <ul v-else class="m-0 list-none p-0">
                <li v-for="(c, i) in u.coupons" :key="c.id ?? c.code ?? i" class="flex flex-wrap items-center gap-2 border-b border-line py-2.5 text-[13px] last:border-b-0">
                  <code class="tabular rounded bg-surface-2 px-1.5 py-0.5 text-[11.5px]">{{ c.code }}</code>
                  <span>{{ c.kind }}<template v-if="c.value != null"> · {{ c.kind === "percent" ? adminFmt.pct(c.value, 0) : adminFmt.usd(c.value) }}</template><template v-if="c.product"> · {{ c.product }}</template></span>
                  <span class="ml-auto text-[11.5px] text-muted"><AdminTime :value="c.redeemed_at ?? c.created_at" /></span>
                </li>
              </ul>
            </template>

            <template v-else>
              <p v-if="!u.sessions?.length" class="m-0 text-[13px] text-muted">No study sessions.</p>
              <div v-else class="overflow-x-auto">
                <pre class="m-0 max-h-96 overflow-auto rounded-lg border border-line bg-surface-2 p-3 text-[11.5px] text-muted">{{ JSON.stringify(u.sessions, null, 2) }}</pre>
              </div>
            </template>
          </div>
        </AdminCard>
      </template>
    </AdminState>
  </div>
</template>
