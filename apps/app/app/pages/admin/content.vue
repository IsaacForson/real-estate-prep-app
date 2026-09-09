<script setup lang="ts">
import type { AdminContentAlert, AdminContentBankSummary, AdminContentVersion } from "~/composables/useAdmin";
import type { AdminColumn } from "~/components/admin/Table.vue";

definePageMeta({ layout: "admin", ssr: false });
useHead({ title: "Content · Admin" });

const { api, requireAdmin } = useAdmin();
const { confirm } = useAdminConfirm();
const action = useAdminAction();

const status = ref<"open" | "resolved" | null>("open");
const alerts = useAdminQuery(() => api.content.alerts(status.value));
const versions = useAdminQuery(() => api.content.versions());
const summary = useAdminQuery(() => api.content.summary());
watch(status, () => { void alerts.reload(); });
onMounted(() => { void requireAdmin(); });

const alertRows = computed(() => alerts.data.value ?? []);
const alertCols: AdminColumn[] = [
  { key: "created_at", label: "Raised", width: "120px" },
  { key: "item_id", label: "Item", width: "170px" },
  { key: "kind", label: "Kind", width: "130px", hideBelow: "md" },
  { key: "message", label: "What changed" },
  { key: "status", label: "Status", width: "100px" },
  { key: "actions", label: "", align: "right", width: "100px" },
];
const message = (a: AdminContentAlert) => a.message ?? a.detail ?? "—";
async function resolve(a: AdminContentAlert) {
  const r = await confirm({ title: `Resolve alert for ${a.item_id ?? a.id}?`, body: "Use this after the item has been re-verified or updated in the repo.", confirmLabel: "Resolve" });
  if (!r.ok) return;
  await action.run(`resolve-${a.id}`, () => api.content.resolveAlert(a.id), "Alert resolved.", alerts.reload);
}

const summaryRows = computed(() => summary.data.value ?? []);
const summaryCols: AdminColumn[] = [
  { key: "bank", label: "Bank", width: "220px" },
  { key: "items_published", label: "Items published", align: "right", width: "140px" },
  { key: "items_in_db", label: "Bodies in DB", align: "right", width: "130px", hideBelow: "md" },
  { key: "forms", label: "Mock forms", align: "right", width: "110px" },
  { key: "last_published_at", label: "Last published", width: "180px" },
];
const bankTone = (b: AdminContentBankSummary) => (b.items_published === 0 ? "muted" : b.items_in_db < b.items_published ? "warn" : "ok");
const versionRows = computed(() => (versions.data.value ?? []).map((v, i) => ({ ...v, _key: v.id ?? String(v.version ?? i) })));
const versionCols: AdminColumn[] = [
  { key: "version", label: "Version", width: "140px" },
  { key: "published_at", label: "Published", width: "180px" },
  { key: "items", label: "Items", align: "right", width: "90px" },
  { key: "notes", label: "Notes" },
];
const itemsOf = (v: AdminContentVersion) => v.items ?? v.item_count ?? null;
const alertFilters = [{ value: "open", label: "Open" }, { value: "resolved", label: "Resolved" }, { value: "all", label: "All" }];
const alertFilter = computed({
  get: () => status.value ?? "all",
  set: (v: string) => { status.value = v === "all" ? null : (v as "open" | "resolved"); },
});
</script>
<template>
  <div class="space-y-4">
    <div>
      <h1 class="m-0 text-[19px] font-semibold tracking-[-0.018em]">Content</h1>
      <p class="m-0 mt-0.5 max-w-3xl text-[13px] leading-relaxed text-muted">
        Alerts come from the nightly <code class="rounded bg-surface-2 px-1 py-px text-[12px]">pipeline watch-sources</code>
        run (a cited authority page changed). Versions are what
        <code class="rounded bg-surface-2 px-1 py-px text-[12px]">pipeline publish --remote</code> shipped to learners.
      </p>
    </div>

    <AdminCard title="Banks" flush>
      <template #actions>
        <AppButton variant="secondary" size="sm" icon="refresh" :loading="summary.loading.value" @click="summary.reload">Refresh</AppButton>
      </template>
      <div class="px-4 pb-4">
        <AdminState :loading="summary.loading.value" :error="summary.error.value" :empty="summary.loaded.value && summaryRows.length === 0" empty-text="No bank has been published yet — run pipeline publish --remote." @retry="summary.reload">
          <AdminTable :columns="summaryCols" :rows="summaryRows" :row-key="(r) => r.bank" dense caption="Published content per bank">
            <template #cell-bank="{ row }">
              <code class="font-mono text-[11.5px]">{{ row.bank }}</code>
            </template>
            <template #cell-items_published="{ row }">
              <span class="tabular">{{ adminFmt.int(row.items_published) }}</span>
              <AdminBadge v-if="row.items_published === 0" text="empty — national fallback" tone="muted" class="ml-1.5" />
            </template>
            <template #cell-items_in_db="{ row }">
              <span class="tabular" :class="bankTone(row) === 'warn' ? 'text-warn' : ''">{{ adminFmt.int(row.items_in_db) }}</span>
            </template>
            <template #cell-forms="{ row }"><span class="tabular">{{ adminFmt.int(row.forms) }}</span></template>
            <template #cell-last_published_at="{ row }"><AdminTime :value="row.last_published_at" absolute /></template>
          </AdminTable>
        </AdminState>
        <p class="mt-3 text-[12px] leading-relaxed text-muted">
          "Bodies in DB" counts <code class="rounded bg-surface-2 px-1 py-px text-[11.5px]">item_content</code> rows; when it trails the published
          count, run <code class="rounded bg-surface-2 px-1 py-px text-[11.5px]">pipeline publish --remote --backfill</code>. Forms come from
          <code class="rounded bg-surface-2 px-1 py-px text-[11.5px]">pipeline forms-build &lt;bank|XX&gt; --remote</code>.
        </p>
      </div>
    </AdminCard>

    <AdminCard title="Content alerts" flush>
      <template #actions>
        <AdminSegmented v-model="alertFilter" :options="alertFilters" aria-label="Alert status" />
        <AppButton variant="secondary" size="sm" icon="refresh" :loading="alerts.loading.value" @click="alerts.reload">Refresh</AppButton>
      </template>
      <div class="px-4 pb-4">
        <AdminState :loading="alerts.loading.value" :error="alerts.error.value" :empty="alerts.loaded.value && alertRows.length === 0" :empty-text="status === 'open' ? 'No open alerts — every cited source still matches.' : 'No alerts in this view.'" @retry="alerts.reload">
          <AdminTable :columns="alertCols" :rows="alertRows" :row-key="(r) => r.id" caption="Content alerts">
            <template #cell-created_at="{ row }"><AdminTime :value="row.created_at" /></template>
            <template #cell-item_id="{ row }"><code class="font-mono text-[11.5px]">{{ row.item_id ?? "—" }}</code></template>
            <template #cell-kind="{ row }"><AdminBadge :text="row.kind" tone="muted" /></template>
            <template #cell-message="{ row }">
              <div class="whitespace-pre-wrap leading-relaxed">{{ message(row) }}</div>
              <a
                v-if="row.source_url"
                :href="row.source_url"
                target="_blank"
                rel="noopener"
                class="mt-0.5 inline-block break-all text-[11.5px] text-accent hover:underline"
              >{{ row.source_url }}</a>
            </template>
            <template #cell-status="{ row }"><AdminBadge :text="row.status" /></template>
            <template #cell-actions="{ row }">
              <AppButton
                v-if="!/resolved/i.test(row.status)"
                variant="secondary"
                size="xs"
                :disabled="!!action.busy.value"
                @click="resolve(row)"
              >Resolve</AppButton>
              <span v-else class="text-[11.5px] text-muted"><AdminTime :value="row.resolved_at" /></span>
            </template>
          </AdminTable>
        </AdminState>
      </div>
    </AdminCard>

    <AdminCard title="Published versions" flush>
      <template #actions>
        <AppButton variant="secondary" size="sm" icon="refresh" :loading="versions.loading.value" @click="versions.reload">Refresh</AppButton>
      </template>
      <div class="px-4 pb-4">
        <AdminState :loading="versions.loading.value" :error="versions.error.value" :empty="versions.loaded.value && versionRows.length === 0" empty-text="Nothing published to the content bucket yet." @retry="versions.reload">
          <AdminTable :columns="versionCols" :rows="versionRows" :row-key="(r) => r._key" dense caption="Content versions">
            <template #cell-version="{ row }"><code class="font-mono text-[11.5px]">{{ row.version ?? row.id ?? "—" }}</code></template>
            <template #cell-published_at="{ row }"><AdminTime :value="row.published_at ?? row.created_at" absolute /></template>
            <template #cell-items="{ row }"><span class="tabular">{{ adminFmt.int(itemsOf(row)) }}</span></template>
            <template #cell-notes="{ row }"><span class="text-muted">{{ row.notes || "—" }}</span></template>
          </AdminTable>
        </AdminState>
      </div>
    </AdminCard>
  </div>
</template>
