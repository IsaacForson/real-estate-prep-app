<script setup lang="ts">
import type { AdminFlaggedDevice } from "~/composables/useAdmin";
import type { AdminColumn } from "~/components/admin/Table.vue";

definePageMeta({ layout: "admin", ssr: false });
useHead({ title: "Devices · Admin" });

const { api, requireAdmin } = useAdmin();
const { confirm } = useAdminConfirm();
const action = useAdminAction();

const q = useAdminQuery(() => api.devices.flagged());
onMounted(() => { void requireAdmin(); });

const filter = ref<"all" | "blocked" | "unblocked">("all");
const accountsOf = (d: AdminFlaggedDevice) => d.accounts ?? d.account_count ?? d.account_ids?.length ?? 0;
const rows = computed(() => (q.data.value ?? []).filter((d) => (filter.value === "all" ? true : filter.value === "blocked" ? d.blocked : !d.blocked)));
const columns: AdminColumn[] = [
  { key: "device_hash", label: "Device", width: "160px" },
  { key: "platform", label: "Platform", width: "110px", hideBelow: "md" },
  { key: "accounts", label: "Accounts", align: "right", width: "90px" },
  { key: "last_seen", label: "Last seen", width: "120px" },
  { key: "first_seen", label: "First seen", width: "120px", hideBelow: "lg" },
  { key: "blocked", label: "State", width: "100px" },
  { key: "notes", label: "Notes" },
  { key: "actions", label: "", align: "right", width: "110px" },
];
const expanded = ref<string | null>(null);

async function toggleBlock(d: AdminFlaggedDevice) {
  const blocking = !d.blocked;
  const r = await confirm({
    title: blocking ? "Block this device?" : "Unblock this device?",
    body: blocking ? "New accounts on this device get no free tier and existing sessions are refused." : "The device is treated normally again.",
    confirmLabel: blocking ? "Block" : "Unblock",
    danger: blocking,
    reason: { label: "Notes", placeholder: d.notes ?? "why (kept on the device record)", required: blocking },
  });
  if (!r.ok) return;
  await action.run(`block-${d.device_hash}`, () => api.devices.block(d.device_hash, blocking, r.reason || (d.notes ?? "")), blocking ? "Device blocked." : "Device unblocked.", q.reload);
}
</script>
<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="m-0 text-xl font-semibold">Devices</h1>
        <p class="m-0 text-sm text-muted">Devices used by 3+ accounts in 30 days (free-tier abuse) and devices you have blocked.</p>
      </div>
      <div class="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Filter">
        <button v-for="f in (['all', 'unblocked', 'blocked'] as const)" :key="f" type="button" role="tab" :aria-selected="filter === f" class="!rounded-md !border-0 !px-3 !py-1 text-sm capitalize" :class="filter === f ? '!bg-accent !text-accent-ink' : '!bg-transparent text-muted hover:text-ink'" @click="filter = f">{{ f }}</button>
      </div>
    </div>

    <AdminState :loading="q.loading.value" :error="q.error.value" :empty="q.loaded.value && rows.length === 0" empty-text="No flagged devices. Good sign." @retry="q.reload">
      <AdminTable :columns="columns" :rows="rows" :row-key="(r) => r.device_hash" caption="Flagged devices">
        <template #cell-device_hash="{ row }">
          <code class="font-mono text-xs" :title="row.device_hash">{{ adminFmt.short(row.device_hash, 14) }}</code>
          <div v-if="row.model" class="text-xs text-muted">{{ row.model }}</div>
        </template>
        <template #cell-platform="{ row }"><span class="capitalize">{{ row.platform ?? "—" }}</span></template>
        <template #cell-accounts="{ row }">
          <button v-if="row.account_ids?.length" type="button" class="!border-0 !bg-transparent !p-0 tabular-nums text-accent" :aria-expanded="expanded === row.device_hash" @click="expanded = expanded === row.device_hash ? null : row.device_hash">{{ adminFmt.int(accountsOf(row)) }}</button>
          <span v-else class="tabular-nums" :class="accountsOf(row) >= 3 ? 'font-semibold text-warn' : ''">{{ adminFmt.int(accountsOf(row)) }}</span>
          <ul v-if="expanded === row.device_hash && row.account_ids?.length" class="m-0 mt-1 list-none space-y-0.5 p-0 text-left">
            <li v-for="a in row.account_ids" :key="a"><NuxtLink :to="`/admin/users/${a}`" class="font-mono text-xs">{{ adminFmt.short(a, 12) }}</NuxtLink></li>
          </ul>
        </template>
        <template #cell-last_seen="{ row }"><AdminTime :value="row.last_seen" /></template>
        <template #cell-first_seen="{ row }"><AdminTime :value="row.first_seen" /></template>
        <template #cell-blocked="{ row }"><AdminBadge :text="row.blocked ? 'blocked' : 'flagged'" :tone="row.blocked ? 'danger' : 'warn'" /></template>
        <template #cell-notes="{ row }"><span class="text-muted">{{ row.notes || "—" }}</span></template>
        <template #cell-actions="{ row }">
          <button type="button" class="!px-2 !py-0.5 text-xs" :class="row.blocked ? '' : '!text-danger'" :disabled="!!action.busy.value" @click="toggleBlock(row)">{{ row.blocked ? "Unblock" : "Block" }}</button>
        </template>
      </AdminTable>
    </AdminState>
  </div>
</template>
