<script setup lang="ts">
import type { AdminCoupon, CouponKind } from "~/composables/useAdmin";
import type { AdminColumn } from "~/components/admin/Table.vue";

definePageMeta({ layout: "admin", ssr: false });
useHead({ title: "Coupons · Admin" });

const { api, requireAdmin } = useAdmin();
const { confirm } = useAdminConfirm();
const action = useAdminAction();
const toast = useAdminToast();

const q = useAdminQuery(() => api.coupons.list());
onMounted(() => { void requireAdmin(); });

// ── create batch ──
const form = reactive({ kind: "gift" as CouponKind, value: 100, product: "complete", max_uses: 1, expires_at: "", note: "", count: 1 });
const generated = ref<string[]>([]);
const valueLabel = computed(() => (form.kind === "percent" ? "Percent off" : form.kind === "amount" ? "Amount off (USD)" : "Value"));
const canSubmit = computed(() => form.count >= 1 && form.count <= 500 && (form.kind === "gift" || (form.value > 0 && (form.kind !== "percent" || form.value <= 100))));

async function create() {
  if (!canSubmit.value) return;
  const r = await confirm({
    title: `Generate ${form.count} ${form.kind} code${form.count === 1 ? "" : "s"}?`,
    body: form.kind === "gift" ? `Each code grants “${form.product}” immediately on redemption.` : `${form.kind === "percent" ? `${form.value}%` : adminFmt.usd(form.value)} off ${form.product} at the web checkout.`,
    confirmLabel: "Generate",
  });
  if (!r.ok) return;
  const codes = await action.run("create", () => api.coupons.create({
    kind: form.kind,
    value: form.kind === "gift" ? null : form.value,
    product: form.product,
    max_uses: form.max_uses > 0 ? form.max_uses : null,
    expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    note: form.note.trim(),
    count: form.count,
  }), "Codes generated.", q.reload);
  if (codes) generated.value = codes;
}
async function copy(text: string, what = "Code") {
  try { await navigator.clipboard.writeText(text); toast.push("ok", `${what} copied.`); }
  catch { toast.push("error", "Clipboard unavailable — select and copy manually."); }
}

// ── list ──
const filter = ref<"active" | "disabled" | "all">("active");
const isDisabled = (c: AdminCoupon) => !!(c.disabled || c.disabled_at);
const isExpired = (c: AdminCoupon) => !!(c.expires_at && new Date(c.expires_at).getTime() < Date.now());
const usesOf = (c: AdminCoupon) => c.uses ?? c.used_count ?? 0;
const exhausted = (c: AdminCoupon) => c.max_uses != null && usesOf(c) >= c.max_uses;
const stateOf = (c: AdminCoupon) => (isDisabled(c) ? "disabled" : isExpired(c) ? "expired" : exhausted(c) ? "used up" : "active");
const rows = computed(() => (q.data.value ?? []).filter((c) => (filter.value === "all" ? true : filter.value === "disabled" ? stateOf(c) !== "active" : stateOf(c) === "active")));
const columns: AdminColumn[] = [
  { key: "code", label: "Code", width: "170px" },
  { key: "kind", label: "Kind", width: "150px" },
  { key: "product", label: "Product", hideBelow: "md" },
  { key: "uses", label: "Uses", align: "right", width: "90px" },
  { key: "expires_at", label: "Expires", width: "120px", hideBelow: "md" },
  { key: "state", label: "State", width: "100px" },
  { key: "note", label: "Note", hideBelow: "lg" },
  { key: "actions", label: "", align: "right", width: "90px" },
];
async function disable(c: AdminCoupon) {
  const r = await confirm({ title: `Disable ${c.code}?`, body: "It can no longer be redeemed. Existing redemptions keep their entitlement.", confirmLabel: "Disable", danger: true });
  if (!r.ok) return;
  await action.run(`disable-${c.code}`, () => api.coupons.disable(c.code), "Coupon disabled.", q.reload);
}
</script>
<template>
  <div class="space-y-4">
    <div>
      <h1 class="m-0 text-xl font-semibold">Coupons</h1>
      <p class="m-0 text-sm text-muted">Gift codes grant the product on redemption; percent/amount codes apply at the future web checkout.</p>
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(300px,1fr)_2fr]">
      <AdminCard title="Create a batch">
        <form class="space-y-3 text-sm" @submit.prevent="create">
          <div class="grid grid-cols-2 gap-3">
            <label class="block"><span class="text-muted">Kind</span>
              <select v-model="form.kind" class="mt-1 w-full"><option value="gift">Gift (100%)</option><option value="percent">Percent off</option><option value="amount">Amount off</option></select>
            </label>
            <label class="block"><span class="text-muted">{{ valueLabel }}</span>
              <input v-model.number="form.value" type="number" min="0" :max="form.kind === 'percent' ? 100 : undefined" step="0.01" class="mt-1 w-full" :disabled="form.kind === 'gift'" />
            </label>
            <label class="block"><span class="text-muted">Product</span>
              <select v-model="form.product" class="mt-1 w-full"><option value="complete">complete</option><option value="pass_guarantee">pass_guarantee</option></select>
            </label>
            <label class="block"><span class="text-muted">Max uses per code</span>
              <input v-model.number="form.max_uses" type="number" min="0" step="1" class="mt-1 w-full" title="0 = unlimited" />
            </label>
            <label class="block"><span class="text-muted">Expires</span>
              <input v-model="form.expires_at" type="date" class="mt-1 w-full" />
            </label>
            <label class="block"><span class="text-muted">How many codes</span>
              <input v-model.number="form.count" type="number" min="1" max="500" step="1" class="mt-1 w-full" required />
            </label>
          </div>
          <label class="block"><span class="text-muted">Note (internal)</span>
            <input v-model="form.note" type="text" class="mt-1 w-full" placeholder="e.g. Reddit giveaway Sept 2026" />
          </label>
          <button type="submit" class="primary w-full" :disabled="!canSubmit || action.busy.value === 'create'">Generate {{ form.count }} code{{ form.count === 1 ? "" : "s" }}</button>
        </form>

        <div v-if="generated.length" class="mt-4 rounded-card border border-ok/40 bg-ok/10 p-3">
          <div class="flex items-center justify-between gap-2 text-sm">
            <strong class="text-ok">{{ generated.length }} code{{ generated.length === 1 ? "" : "s" }} generated</strong>
            <button type="button" class="!px-2 !py-0.5 text-xs" @click="copy(generated.join('\n'), 'All codes')">Copy all</button>
          </div>
          <ul class="m-0 mt-2 max-h-56 list-none space-y-1 overflow-auto p-0">
            <li v-for="c in generated" :key="c" class="flex items-center gap-2">
              <code class="flex-1 rounded bg-surface px-2 py-1 text-sm tracking-wide">{{ c }}</code>
              <button type="button" class="!px-2 !py-0.5 text-xs" @click="copy(c)">Copy</button>
            </li>
          </ul>
        </div>
      </AdminCard>

      <AdminCard title="All coupons" flush>
        <template #actions>
          <div class="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist">
            <button v-for="f in (['active', 'disabled', 'all'] as const)" :key="f" type="button" role="tab" :aria-selected="filter === f" class="!rounded-md !border-0 !px-3 !py-1 text-sm capitalize" :class="filter === f ? '!bg-accent !text-accent-ink' : '!bg-transparent text-muted hover:text-ink'" @click="filter = f">{{ f === "disabled" ? "Inactive" : f }}</button>
          </div>
          <button type="button" class="!px-3 !py-1 text-sm" :disabled="q.loading.value" @click="q.reload">Refresh</button>
        </template>
        <div class="px-4 pb-4">
          <AdminState :loading="q.loading.value" :error="q.error.value" :empty="q.loaded.value && rows.length === 0" empty-text="No coupons in this view." @retry="q.reload">
            <AdminTable :columns="columns" :rows="rows" :row-key="(r) => r.code" dense caption="Coupons">
              <template #cell-code="{ row }">
                <span class="inline-flex items-center gap-1">
                  <code class="rounded bg-surface-2 px-1.5 py-0.5 text-xs tracking-wide">{{ row.code }}</code>
                  <button type="button" class="!border-0 !bg-transparent !p-0 text-xs text-accent" :aria-label="`Copy ${row.code}`" @click="copy(row.code)">copy</button>
                </span>
              </template>
              <template #cell-kind="{ row }">
                {{ row.kind }}<template v-if="row.kind !== 'gift' && row.value != null"> · {{ row.kind === "percent" ? adminFmt.pct(row.value, 0) : adminFmt.usd(row.value) }}</template>
              </template>
              <template #cell-uses="{ row }"><span class="tabular-nums">{{ adminFmt.int(usesOf(row)) }} / {{ row.max_uses ?? "∞" }}</span></template>
              <template #cell-expires_at="{ row }"><AdminTime :value="row.expires_at" /></template>
              <template #cell-state="{ row }"><AdminBadge :text="stateOf(row)" :tone="stateOf(row) === 'active' ? 'ok' : stateOf(row) === 'disabled' ? 'danger' : 'muted'" /></template>
              <template #cell-note="{ row }"><span class="text-muted">{{ row.note || "—" }}</span></template>
              <template #cell-actions="{ row }">
                <button v-if="!isDisabled(row)" type="button" class="!px-2 !py-0.5 text-xs !text-danger" :disabled="!!action.busy.value" @click="disable(row)">Disable</button>
              </template>
            </AdminTable>
          </AdminState>
        </div>
      </AdminCard>
    </div>
  </div>
</template>
