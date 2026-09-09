<script setup lang="ts">
import type { AdminEvent, AdminRange } from "~/composables/useAdmin";
import type { AdminColumn } from "~/components/admin/Table.vue";

definePageMeta({ layout: "admin", ssr: false });
useHead({ title: "Sales · Admin" });

const { api, requireAdmin } = useAdmin();
const ranges: Array<{ v: AdminRange; label: string }> = [
  { v: "7d", label: "7 days" }, { v: "30d", label: "30 days" }, { v: "90d", label: "90 days" }, { v: "all", label: "All time" },
];
const range = ref<AdminRange>("30d");
const kpis = useAdminQuery(() => api.kpis(range.value));
watch(range, () => { void kpis.reload(); });
onMounted(() => { void requireAdmin(); });

// recent purchase events — `kind: "purchase_*"` asks the function for the prefix; we also filter here
const events = useAdminQuery(async () => {
  const list = await api.events.list({ kind: "purchase_*", limit: 100 });
  return list.filter((e) => e.kind.startsWith("purchase"));
});

const k = computed(() => kpis.data.value);
const revenue = computed(() => (k.value?.purchases ?? []).reduce((s, p) => s + (p.revenue_usd ?? 0), 0));
const count = computed(() => (k.value?.purchases ?? []).reduce((s, p) => s + (p.count ?? 0), 0));
const aov = computed(() => (count.value ? revenue.value / count.value : null));
const labels = computed(() => (k.value?.series ?? []).map((s) => s.date));
const purchaseSeries = computed(() => [{ name: "Purchases", values: (k.value?.series ?? []).map((s) => s.purchases), color: "ok" as const }]);

const storeCols: AdminColumn[] = [
  { key: "store", label: "Store" },
  { key: "count", label: "Purchases", align: "right" },
  { key: "revenue_usd", label: "Revenue", align: "right" },
  { key: "share", label: "Share", align: "right", width: "90px" },
];
const storeRows = computed(() => (k.value?.purchases ?? []).map((p) => ({ ...p, share: revenue.value ? (p.revenue_usd / revenue.value) * 100 : 0 })));

const eventCols: AdminColumn[] = [
  { key: "at", label: "When", width: "130px" },
  { key: "kind", label: "Event", width: "170px" },
  { key: "user_id", label: "User", width: "130px" },
  { key: "store", label: "Store", width: "100px", hideBelow: "md" },
  { key: "product", label: "Product", hideBelow: "md" },
  { key: "amount", label: "Amount", align: "right", width: "100px" },
];
const prop = (e: AdminEvent, ...keys: string[]) => {
  for (const k of keys) { const v = e.props?.[k]; if (v != null && v !== "") return v; }
  return null;
};
const amount = (e: AdminEvent) => {
  const v = prop(e, "amount_usd", "revenue_usd", "price_usd", "amount", "price");
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? adminFmt.usd(n) : "—";
};
const eventRows = computed(() => (events.data.value ?? []).map((e, i) => ({ ...e, _key: e.id ?? `${e.kind}-${i}` })));
</script>
<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="m-0 text-xl font-semibold">Sales</h1>
        <p class="m-0 text-sm text-muted">Store purchases, refunds and conversion. Revenue is what the stores report, before their fees.</p>
      </div>
      <div class="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Time range">
        <button v-for="r in ranges" :key="r.v" type="button" role="tab" :aria-selected="range === r.v" class="!rounded-md !border-0 !px-3 !py-1 text-sm" :class="range === r.v ? '!bg-accent !text-accent-ink' : '!bg-transparent text-muted hover:text-ink'" @click="range = r.v">{{ r.label }}</button>
      </div>
    </div>

    <AdminState :loading="kpis.loading.value" :error="kpis.error.value" :empty="!k" @retry="kpis.reload">
      <template v-if="k">
        <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <AdminKpiTile label="Revenue" :value="adminFmt.usd(revenue)" tone="ok" />
          <AdminKpiTile label="Purchases" :value="adminFmt.int(count)" :hint="aov != null ? `avg ${adminFmt.usd(aov)}` : undefined" />
          <AdminKpiTile label="Refunds" :value="adminFmt.int(k.refunds)" :hint="count ? `${adminFmt.pct((k.refunds / count) * 100)} of purchases` : undefined" :tone="k.refunds ? 'warn' : 'default'" />
          <AdminKpiTile label="Conversion" :value="adminFmt.pct(k.conversion_pct)" hint="signups → purchase" />
          <AdminKpiTile label="Entitled now" :value="adminFmt.int(k.active_complete)" :hint="`${adminFmt.int(k.active_guarantee)} pass guarantee`" />
        </div>
        <div class="grid gap-4 xl:grid-cols-[2fr_1fr]">
          <AdminCard title="Purchases per day">
            <AdminChart :labels="labels" :series="purchaseSeries" type="bar" title="Purchases per day" />
          </AdminCard>
          <AdminCard title="By store">
            <p v-if="!storeRows.length" class="m-0 text-sm text-muted">No purchases in this range.</p>
            <AdminTable v-else :columns="storeCols" :rows="storeRows" :row-key="(r) => r.store" dense caption="Revenue by store">
              <template #cell-store="{ row }"><span class="font-medium capitalize">{{ row.store }}</span></template>
              <template #cell-count="{ row }"><span class="tabular-nums">{{ adminFmt.int(row.count) }}</span></template>
              <template #cell-revenue_usd="{ row }"><span class="tabular-nums">{{ adminFmt.usd(row.revenue_usd) }}</span></template>
              <template #cell-share="{ row }"><span class="tabular-nums text-muted">{{ adminFmt.pct(row.share, 0) }}</span></template>
            </AdminTable>
          </AdminCard>
        </div>
      </template>
    </AdminState>

    <AdminCard title="Recent purchase events" subtitle="latest 100 purchase_* events across all users" flush>
      <template #actions><button type="button" class="!px-3 !py-1 text-sm" :disabled="events.loading.value" @click="events.reload">Refresh</button></template>
      <div class="px-4 pb-4">
        <AdminState :loading="events.loading.value" :error="events.error.value" :empty="events.loaded.value && eventRows.length === 0" empty-text="No purchase events yet." @retry="events.reload">
          <AdminTable :columns="eventCols" :rows="eventRows" :row-key="(r) => r._key" :row-to="(r) => (r.user_id ? `/admin/users/${r.user_id}` : null)" dense caption="Recent purchase events">
            <template #cell-at="{ row }"><AdminTime :value="row.at ?? row.created_at" /></template>
            <template #cell-kind="{ row }"><AdminBadge :text="row.kind" :tone="row.kind.includes('refund') ? 'danger' : 'ok'" /></template>
            <template #cell-user_id="{ row }"><span class="font-mono text-xs">{{ adminFmt.short(row.user_id, 10) }}</span></template>
            <template #cell-store="{ row }"><span class="capitalize">{{ prop(row, "store", "platform") ?? "—" }}</span></template>
            <template #cell-product="{ row }">{{ prop(row, "product", "product_id", "sku") ?? "—" }}</template>
            <template #cell-amount="{ row }"><span class="tabular-nums">{{ amount(row) }}</span></template>
          </AdminTable>
        </AdminState>
      </div>
    </AdminCard>
  </div>
</template>
