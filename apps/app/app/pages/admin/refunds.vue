<script setup lang="ts">
import type { AdminRefund, RefundStatus } from "~/composables/useAdmin";
import type { AdminColumn } from "~/components/admin/Table.vue";
/**
 * Refund decisions, full and partial.
 *
 * Worth being blunt about what this screen can and cannot do. Purchases go through the App Store
 * and Play, so the money is Apple's and Google's to return — no button here moves cash. What it
 * does own is the decision: who asked, on what grounds, whether the published guarantee conditions
 * were met, what was approved, and which entitlements that cost them. Approving revokes access
 * immediately; the payout is then made in App Store Connect or Play Console and its reference
 * recorded here, which is the only evidence the refund actually happened.
 *
 * When web checkout goes live the same rows carry a processor refund id instead, and the payout
 * step can become an API call without changing anything a operator sees.
 */
definePageMeta({ layout: "admin", ssr: false });
useHead({ title: "Refunds · Admin" });

const { api, requireAdmin } = useAdmin();
const { confirm } = useAdminConfirm();
const action = useAdminAction();

const status = ref<RefundStatus | "all">("open");
const q = useAdminQuery(() => api.refunds.list(status.value === "all" ? null : status.value));
watch(status, () => { void q.reload(); });
onMounted(() => { void requireAdmin(); });

const rows = computed(() => q.data.value?.refunds ?? []);
const totals = computed(() => q.data.value?.totals ?? null);
const filters = [
  { value: "open", label: "Open" },
  { value: "approved", label: "To pay" },
  { value: "paid", label: "Paid" },
  { value: "denied", label: "Denied" },
  { value: "all", label: "All" },
];

const columns: AdminColumn[] = [
  { key: "email", label: "Learner" },
  { key: "kind", label: "Kind", width: "110px" },
  { key: "products", label: "Covers", width: "170px", hideBelow: "md" },
  { key: "amount", label: "Amount", align: "right", width: "100px" },
  { key: "store", label: "Store", width: "110px", hideBelow: "lg" },
  { key: "created_at", label: "Filed", width: "110px" },
  { key: "status", label: "Status", width: "100px" },
  { key: "actions", label: "", align: "right", width: "180px" },
];

const money = (cents: number | null | undefined) => (cents == null ? "—" : adminFmt.usd(cents / 100));
const statusTone = (s: RefundStatus) => (s === "paid" ? "ok" : s === "denied" ? "muted" : s === "approved" ? "warn" : "accent");
/** Where the operator has to go to actually return the money. */
const payoutHome: Record<string, string> = {
  app_store: "App Store Connect",
  play: "Play Console",
  paddle: "Paddle",
  lemonsqueezy: "Lemon Squeezy",
  coupon: "nothing to return (coupon)",
  manual: "however it was taken",
};

async function approve(r: AdminRefund) {
  const covers = r.products.length ? r.products.join(" and ") : "no entitlements";
  const res = await confirm({
    title: `Approve this ${r.kind} refund?`,
    body: `${covers} will be revoked immediately for ${r.email ?? "this learner"}. The money still has to be returned in ${payoutHome[r.store ?? "manual"] ?? "the store"} afterwards.`,
    confirmLabel: "Approve",
    reason: {
      label: "Amount to refund, in dollars",
      required: true,
      type: "number",
      min: 0,
      step: 0.01,
      placeholder: r.amount_cents != null ? String(r.amount_cents / 100) : "59",
    },
  });
  if (!res.ok) return;
  const dollars = Number.parseFloat(res.reason);
  if (!Number.isFinite(dollars) || dollars < 0) return;
  await action.run(`approve-${r.id}`, () => api.refunds.decide(r.id, true, null, Math.round(dollars * 100)), "Refund approved and access revoked.", q.reload);
}

async function deny(r: AdminRefund) {
  const res = await confirm({
    title: "Deny this refund?",
    body: "Nothing changes for the learner. The reason is stored and shown here.",
    confirmLabel: "Deny",
    danger: true,
    reason: { label: "Reason", required: true, placeholder: "e.g. outside the 90-day window" },
  });
  if (!res.ok) return;
  await action.run(`deny-${r.id}`, () => api.refunds.decide(r.id, false, res.reason, null), "Refund denied.", q.reload);
}

async function markPaid(r: AdminRefund) {
  const res = await confirm({
    title: "Record the payout",
    body: `Enter the refund reference from ${payoutHome[r.store ?? "manual"] ?? "the store"}. This is the only record that the money went back.`,
    confirmLabel: "Mark paid",
    reason: { label: "Store refund reference", required: true, placeholder: "e.g. 1000000123456789" },
  });
  if (!res.ok) return;
  await action.run(`paid-${r.id}`, () => api.refunds.markPaid(r.id, res.reason), "Payout recorded.", q.reload);
}
</script>
<template>
  <div class="space-y-5">
    <AdminPageHead title="Refunds" subtitle="Full, partial and pass-guarantee refunds. Approving revokes access; paying happens in the store.">
      <AdminSegmented
        :model-value="status"
        :options="filters"
        aria-label="Status"
        @update:model-value="(v) => (status = v as typeof status)"
      />
    </AdminPageHead>

    <AdminState :loading="q.loading.value" :error="q.error.value" :empty="q.loaded.value && rows.length === 0 && !totals" @retry="q.reload">
      <div v-if="totals" class="grid grid-cols-2 gap-4 md:grid-cols-4">
        <AdminKpiTile label="Open" :value="adminFmt.int(totals.open)" :tone="totals.open > 0 ? 'warn' : 'default'" hint="awaiting a decision" />
        <AdminKpiTile label="Approved, unpaid" :value="adminFmt.int(totals.approved)" :tone="totals.approved > 0 ? 'warn' : 'default'" :hint="`${money(totals.awaiting_payout_cents)} to return`" />
        <AdminKpiTile label="Paid" :value="adminFmt.int(totals.paid)" tone="ok" :hint="`${money(totals.paid_cents)} returned`" />
        <AdminKpiTile label="Denied" :value="adminFmt.int(totals.denied)" />
      </div>

      <!--
        The bit that trips people up: access and money are two separate steps, and only the first
        one happens in this app. Say so on the screen rather than in a runbook nobody reads.
      -->
      <div v-if="totals && totals.approved > 0" class="flex items-start gap-3 rounded-card border border-warn/40 bg-warn-soft p-4">
        <Icon name="alert" :size="18" class="mt-0.5 shrink-0 text-warn" />
        <p class="m-0 text-[13px] leading-relaxed">
          <strong class="font-semibold">{{ totals.approved }} approved refund{{ totals.approved === 1 ? "" : "s" }} still owe money.</strong>
          Access has already been revoked, but {{ money(totals.awaiting_payout_cents) }} has not been returned. Issue it in the
          store and record the reference here.
        </p>
      </div>

      <AdminCard title="Requests" flush>
        <AdminState
          :loading="q.loading.value"
          :empty="q.loaded.value && rows.length === 0"
          :empty-text="status === 'open' ? 'No refunds waiting on you.' : 'Nothing in this view.'"
          inline
        >
          <AdminTable :columns="columns" :rows="rows" :row-key="(r) => r.id" caption="Refund requests">
            <template #cell-email="{ row }">
              <NuxtLink :to="`/admin/users/${row.user_id}`" class="font-medium text-accent hover:underline">
                {{ row.email ?? adminFmt.short(row.user_id, 12) }}
              </NuxtLink>
              <div v-if="row.reason" class="mt-0.5 max-w-[40ch] truncate text-[11.5px] text-muted" :title="row.reason">{{ row.reason }}</div>
              <div v-if="row.decision_note" class="mt-0.5 max-w-[40ch] truncate text-[11.5px] text-muted" :title="row.decision_note">
                decision: {{ row.decision_note }}
              </div>
            </template>
            <template #cell-kind="{ row }"><AdminBadge :text="row.kind" :tone="row.kind === 'guarantee' ? 'accent' : 'muted'" /></template>
            <template #cell-products="{ row }">
              <span v-if="!row.products.length" class="text-muted">access kept</span>
              <span v-else class="text-[12px]">{{ row.products.join(", ") }}</span>
            </template>
            <template #cell-amount="{ row }"><span class="tabular font-medium">{{ money(row.amount_cents) }}</span></template>
            <template #cell-store="{ row }"><span class="text-muted">{{ row.store ?? "—" }}</span></template>
            <template #cell-created_at="{ row }"><AdminTime :value="row.created_at" /></template>
            <template #cell-status="{ row }">
              <AdminBadge :text="row.status" :tone="statusTone(row.status)" />
              <div v-if="row.external_refund_id" class="mt-0.5 font-mono text-[11px] text-muted" :title="row.external_refund_id">
                {{ adminFmt.short(row.external_refund_id, 12) }}
              </div>
            </template>
            <template #cell-actions="{ row }">
              <span class="flex justify-end gap-1">
                <template v-if="row.status === 'open'">
                  <AppButton variant="primary" size="xs" :disabled="!!action.busy.value" @click="approve(row)">Approve</AppButton>
                  <AppButton variant="ghost" size="xs" class="!text-danger" :disabled="!!action.busy.value" @click="deny(row)">Deny</AppButton>
                </template>
                <AppButton
                  v-else-if="row.status === 'approved'"
                  variant="secondary"
                  size="xs"
                  :disabled="!!action.busy.value"
                  @click="markPaid(row)"
                >Record payout</AppButton>
                <span v-else class="text-[11.5px] text-muted">
                  <template v-if="row.paid_at">paid <AdminTime :value="row.paid_at" /></template>
                  <template v-else-if="row.decided_at">decided <AdminTime :value="row.decided_at" /></template>
                </span>
              </span>
            </template>
          </AdminTable>
        </AdminState>
      </AdminCard>

      <p class="m-0 text-[12px] leading-relaxed text-muted">
        File a request from a learner's page, where the pass-guarantee conditions are checked for
        you. A partial refund is just a smaller amount with fewer products listed — leave the
        products empty to return money without taking anything away.
      </p>
    </AdminState>
  </div>
</template>
