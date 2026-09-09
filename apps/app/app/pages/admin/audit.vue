<script setup lang="ts">
import type { AdminColumn } from "~/components/admin/Table.vue";

definePageMeta({ layout: "admin", ssr: false });
useHead({ title: "Audit log · Admin" });

const { api, requireAdmin } = useAdmin();
const LIMIT = 50;
const cursors = ref<Array<string | null>>([null]);
const page = ref(1);
const next = ref<string | null>(null);

const q = useAdminQuery(async () => {
  const r = await api.audit.list(LIMIT, cursors.value[page.value - 1] ?? null);
  next.value = r.next;
  return r.entries;
});
onMounted(() => { void requireAdmin(); });
function goNext() { if (!next.value) return; cursors.value = [...cursors.value.slice(0, page.value), next.value]; page.value += 1; void q.reload(); }
function goPrev() { if (page.value <= 1) return; page.value -= 1; void q.reload(); }

const rows = computed(() => q.data.value ?? []);
const columns: AdminColumn[] = [
  { key: "created_at", label: "When", width: "130px" },
  { key: "admin", label: "Admin", width: "160px", hideBelow: "md" },
  { key: "action", label: "Action", width: "180px" },
  { key: "target", label: "Target" },
  { key: "diff", label: "Change", hideBelow: "lg" },
];
const expanded = ref<string | null>(null);
const targetLink = (type: string | null, id: string | null) => (type && id && /user|profile/i.test(type) ? `/admin/users/${id}` : null);
const hasDiff = (b: unknown, a: unknown) => (b != null && b !== "") || (a != null && a !== "");
const summarize = (v: unknown) => {
  if (v == null) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};
</script>
<template>
  <div class="space-y-4">
    <AdminPageHead
      title="Audit log"
      subtitle="Every admin-api call, newest first. Expand a row to see the before/after snapshot."
    >
      <AppButton variant="secondary" size="sm" icon="refresh" :loading="q.loading.value" @click="q.reload">Refresh</AppButton>
    </AdminPageHead>

    <AdminState :loading="q.loading.value" :error="q.error.value" :empty="q.loaded.value && rows.length === 0" empty-text="No admin actions recorded yet." @retry="q.reload">
      <AdminTable :columns="columns" :rows="rows" :row-key="(r) => r.id" dense caption="Audit log">
        <template #cell-created_at="{ row }"><AdminTime :value="row.created_at" /></template>
        <template #cell-admin="{ row }">
          <span class="text-[12px]">{{ row.admin_email ?? adminFmt.short(row.admin_id, 10) }}</span>
        </template>
        <template #cell-action="{ row }"><code class="rounded bg-surface-2 px-1.5 py-0.5 text-[11.5px]">{{ row.action }}</code></template>
        <template #cell-target="{ row }">
          <span v-if="row.target_type" class="text-[11px] uppercase tracking-[0.04em] text-muted">{{ row.target_type }} </span>
          <NuxtLink v-if="targetLink(row.target_type, row.target_id)" :to="targetLink(row.target_type, row.target_id)!" class="font-mono text-[11.5px] text-accent hover:underline">{{ row.target_id }}</NuxtLink>
          <span v-else class="font-mono text-[11.5px]">{{ row.target_id ?? "—" }}</span>
        </template>
        <template #cell-diff="{ row }">
          <template v-if="hasDiff(row.before, row.after)">
            <button
              type="button"
              class="text-[11.5px] font-medium text-accent hover:underline"
              :aria-expanded="expanded === row.id"
              @click="expanded = expanded === row.id ? null : row.id"
            >{{ expanded === row.id ? "Hide" : "Show" }} before / after</button>
            <div v-if="expanded === row.id" class="mt-1.5 grid gap-2 md:grid-cols-2">
              <div>
                <div class="text-[11px] uppercase tracking-[0.04em] text-muted">Before</div>
                <pre class="m-0 mt-1 max-h-48 overflow-auto rounded-lg border border-line bg-surface-2 p-2 text-[11.5px]">{{ row.before == null ? "—" : JSON.stringify(row.before, null, 2) }}</pre>
              </div>
              <div>
                <div class="text-[11px] uppercase tracking-[0.04em] text-muted">After</div>
                <pre class="m-0 mt-1 max-h-48 overflow-auto rounded-lg border border-line bg-surface-2 p-2 text-[11.5px]">{{ row.after == null ? "—" : JSON.stringify(row.after, null, 2) }}</pre>
              </div>
            </div>
            <div v-else class="text-[11.5px] text-muted">{{ summarize(row.after ?? row.before) }}</div>
          </template>
          <span v-else class="text-[11.5px] text-muted">—</span>
        </template>
      </AdminTable>
      <AdminPager :page="page" :count="rows.length" :has-prev="page > 1" :has-next="!!next" :loading="q.loading.value" label="entries" @prev="goPrev" @next="goNext" />
    </AdminState>
  </div>
</template>
