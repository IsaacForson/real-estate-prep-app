<script setup lang="ts">
import type { AdminRange } from "~/composables/useAdmin";

definePageMeta({ layout: "admin", ssr: false });
useHead({ title: "Overview · Admin" });

const { api, requireAdmin } = useAdmin();
const route = useRoute();
const router = useRouter();
const ranges: Array<{ v: AdminRange; label: string }> = [
  { v: "7d", label: "7 days" }, { v: "30d", label: "30 days" }, { v: "90d", label: "90 days" }, { v: "all", label: "All time" },
];
const range = ref<AdminRange>((["7d", "30d", "90d", "all"] as const).includes(route.query.range as AdminRange) ? (route.query.range as AdminRange) : "30d");

const q = useAdminQuery(() => api.kpis(range.value));
watch(range, (r) => { void router.replace({ query: { ...route.query, range: r } }); void q.reload(); });
onMounted(() => { void requireAdmin(); });

const k = computed(() => q.data.value);
const revenue = computed(() => (k.value?.purchases ?? []).reduce((s, p) => s + (p.revenue_usd ?? 0), 0));
const purchaseCount = computed(() => (k.value?.purchases ?? []).reduce((s, p) => s + (p.count ?? 0), 0));
const labels = computed(() => (k.value?.series ?? []).map((s) => s.date));
const growth = computed(() => [
  { name: "Signups", values: (k.value?.series ?? []).map((s) => s.signups), color: "accent" as const },
  { name: "Purchases", values: (k.value?.series ?? []).map((s) => s.purchases), color: "ok" as const },
]);
const answers = computed(() => [{ name: "Answers", values: (k.value?.series ?? []).map((s) => s.answers), color: "accent" as const }]);
</script>
<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="m-0 text-xl font-semibold">Overview</h1>
        <p class="m-0 text-sm text-muted">Signups, activity and revenue across web, Android and iOS.</p>
      </div>
      <div class="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Time range">
        <button
          v-for="r in ranges"
          :key="r.v"
          type="button"
          role="tab"
          :aria-selected="range === r.v"
          class="!rounded-md !border-0 !px-3 !py-1 text-sm"
          :class="range === r.v ? '!bg-accent !text-accent-ink' : '!bg-transparent text-muted hover:text-ink'"
          @click="range = r.v"
        >{{ r.label }}</button>
      </div>
    </div>

    <AdminState :loading="q.loading.value" :error="q.error.value" :empty="!k" @retry="q.reload">
      <template v-if="k">
        <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <AdminKpiTile label="Signups" :value="adminFmt.int(k.signups)" :hint="`in ${ranges.find((r) => r.v === range)?.label.toLowerCase()}`" />
          <AdminKpiTile label="DAU / WAU / MAU" :value="`${adminFmt.int(k.dau)} / ${adminFmt.int(k.wau)} / ${adminFmt.int(k.mau)}`" hint="active learners" />
          <AdminKpiTile label="Revenue" :value="adminFmt.usd(revenue)" :hint="`${adminFmt.int(purchaseCount)} purchases`" tone="ok" to="/admin/sales" />
          <AdminKpiTile label="Conversion" :value="adminFmt.pct(k.conversion_pct)" hint="signups → purchase" />
          <AdminKpiTile label="Refunds" :value="adminFmt.int(k.refunds)" :tone="k.refunds > 0 ? 'warn' : 'default'" to="/admin/sales" />
          <AdminKpiTile label="Entitled" :value="adminFmt.int(k.active_complete)" :hint="`${adminFmt.int(k.active_guarantee)} with guarantee`" />
          <AdminKpiTile label="Answers" :value="adminFmt.int(k.answers)" hint="questions answered" />
          <AdminKpiTile label="Mocks completed" :value="adminFmt.int(k.mocks_completed)" />
          <AdminKpiTile label="Open tickets" :value="adminFmt.int(k.tickets_open)" :tone="k.tickets_open > 0 ? 'warn' : 'default'" to="/admin/support" />
          <AdminKpiTile label="Reviews pending" :value="adminFmt.int(k.reviews_pending)" :tone="k.reviews_pending > 0 ? 'warn' : 'default'" to="/admin/reviews" />
          <AdminKpiTile v-for="p in k.purchases" :key="p.store" :label="`${p.store} revenue`" :value="adminFmt.usd(p.revenue_usd)" :hint="`${adminFmt.int(p.count)} purchases`" />
        </div>

        <div class="grid gap-4 xl:grid-cols-2">
          <AdminCard title="Signups & purchases" subtitle="per day">
            <AdminChart :labels="labels" :series="growth" type="line" title="Signups and purchases per day" />
          </AdminCard>
          <AdminCard title="Answers" subtitle="questions answered per day">
            <AdminChart :labels="labels" :series="answers" type="bar" title="Answers per day" />
          </AdminCard>
        </div>
      </template>
    </AdminState>
  </div>
</template>
