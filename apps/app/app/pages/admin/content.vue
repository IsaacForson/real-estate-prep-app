<script setup lang="ts">
import type { AdminContentAlert, AdminContentVersion } from "~/composables/useAdmin";
import type { AdminColumn } from "~/components/admin/Table.vue";

definePageMeta({ layout: "admin", ssr: false });
useHead({ title: "Content · Admin" });

const { api, requireAdmin } = useAdmin();
const { confirm } = useAdminConfirm();
const action = useAdminAction();

const status = ref<"open" | "resolved" | null>("open");
const alerts = useAdminQuery(() => api.content.alerts(status.value));
const versions = useAdminQuery(() => api.content.versions());
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

const versionRows = computed(() => (versions.data.value ?? []).map((v, i) => ({ ...v, _key: v.id ?? String(v.version ?? i) })));
const versionCols: AdminColumn[] = [
  { key: "version", label: "Version", width: "140px" },
  { key: "published_at", label: "Published", width: "180px" },
  { key: "items", label: "Items", align: "right", width: "90px" },
  { key: "notes", label: "Notes" },
];
const itemsOf = (v: AdminContentVersion) => v.items ?? v.item_count ?? null;
</script>
<template>
  <div class="space-y-4">
    <div>
      <h1 class="m-0 text-xl font-semibold">Content</h1>
      <p class="m-0 text-sm text-muted">Alerts come from the nightly <code>pipeline watch-sources</code> run (a cited authority page changed). Versions are what <code>pipeline publish --remote</code> shipped to learners.</p>
    </div>

    <AdminCard title="Content alerts" flush>
      <template #actions>
        <div class="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Alert status">
          <button v-for="s in ([['open', 'Open'], ['resolved', 'Resolved'], [null, 'All']] as const)" :key="s[1]" type="button" role="tab" :aria-selected="status === s[0]" class="!rounded-md !border-0 !px-3 !py-1 text-sm" :class="status === s[0] ? '!bg-accent !text-accent-ink' : '!bg-transparent text-muted hover:text-ink'" @click="status = s[0]">{{ s[1] }}</button>
        </div>
        <button type="button" class="!px-3 !py-1 text-sm" :disabled="alerts.loading.value" @click="alerts.reload">Refresh</button>
      </template>
      <div class="px-4 pb-4">
        <AdminState :loading="alerts.loading.value" :error="alerts.error.value" :empty="alerts.loaded.value && alertRows.length === 0" :empty-text="status === 'open' ? 'No open alerts — every cited source still matches.' : 'No alerts in this view.'" @retry="alerts.reload">
          <AdminTable :columns="alertCols" :rows="alertRows" :row-key="(r) => r.id" caption="Content alerts">
            <template #cell-created_at="{ row }"><AdminTime :value="row.created_at" /></template>
            <template #cell-item_id="{ row }"><code class="text-xs">{{ row.item_id ?? "—" }}</code></template>
            <template #cell-kind="{ row }"><AdminBadge :text="row.kind" tone="muted" /></template>
            <template #cell-message="{ row }">
              <div class="whitespace-pre-wrap">{{ message(row) }}</div>
              <a v-if="row.source_url" :href="row.source_url" target="_blank" rel="noopener" class="text-xs">{{ row.source_url }}</a>
            </template>
            <template #cell-status="{ row }"><AdminBadge :text="row.status" /></template>
            <template #cell-actions="{ row }">
              <button v-if="!/resolved/i.test(row.status)" type="button" class="!px-2 !py-0.5 text-xs" :disabled="!!action.busy.value" @click="resolve(row)">Resolve</button>
              <span v-else class="text-xs text-muted"><AdminTime :value="row.resolved_at" /></span>
            </template>
          </AdminTable>
        </AdminState>
      </div>
    </AdminCard>

    <AdminCard title="Published versions" flush>
      <template #actions><button type="button" class="!px-3 !py-1 text-sm" :disabled="versions.loading.value" @click="versions.reload">Refresh</button></template>
      <div class="px-4 pb-4">
        <AdminState :loading="versions.loading.value" :error="versions.error.value" :empty="versions.loaded.value && versionRows.length === 0" empty-text="Nothing published to the content bucket yet." @retry="versions.reload">
          <AdminTable :columns="versionCols" :rows="versionRows" :row-key="(r) => r._key" dense caption="Content versions">
            <template #cell-version="{ row }"><code class="text-xs">{{ row.version ?? row.id ?? "—" }}</code></template>
            <template #cell-published_at="{ row }"><AdminTime :value="row.published_at ?? row.created_at" absolute /></template>
            <template #cell-items="{ row }"><span class="tabular-nums">{{ adminFmt.int(itemsOf(row)) }}</span></template>
            <template #cell-notes="{ row }"><span class="text-muted">{{ row.notes || "—" }}</span></template>
          </AdminTable>
        </AdminState>
      </div>
    </AdminCard>
  </div>
</template>
