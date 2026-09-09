<script setup lang="ts">
import type { AdminUserRow } from "~/composables/useAdmin";
import type { AdminColumn } from "~/components/admin/Table.vue";

definePageMeta({ layout: "admin", ssr: false });
useHead({ title: "Users · Admin" });

const { api, requireAdmin } = useAdmin();
const route = useRoute();
const router = useRouter();
const LIMIT = 50;

const query = ref(typeof route.query.q === "string" ? route.query.q : "");
const cursors = ref<Array<string | null>>([null]); // cursor stack; index = page - 1
const page = ref(1);
const next = ref<string | null>(null);

const q = useAdminQuery(async () => {
  const r = await api.users.search(query.value.trim(), LIMIT, cursors.value[page.value - 1] ?? null);
  next.value = r.next;
  return r.users;
});
onMounted(() => { void requireAdmin(); });

// the layout's search box pushes ?q=; follow it
watch(() => route.query.q, (v) => { query.value = typeof v === "string" ? v : ""; resetAndLoad(); });
function resetAndLoad() { cursors.value = [null]; page.value = 1; void q.reload(); }
function submit() { void router.replace({ query: query.value.trim() ? { q: query.value.trim() } : {} }); resetAndLoad(); }
function goNext() { if (!next.value) return; cursors.value = [...cursors.value.slice(0, page.value), next.value]; page.value += 1; void q.reload(); }
function goPrev() { if (page.value <= 1) return; page.value -= 1; void q.reload(); }

const rows = computed<AdminUserRow[]>(() => q.data.value ?? []);
const columns: AdminColumn[] = [
  { key: "email", label: "Email" },
  { key: "status", label: "Status", width: "120px" },
  { key: "entitlements", label: "Entitlements", hideBelow: "md" },
  { key: "home_jurisdiction", label: "State", width: "70px", hideBelow: "lg" },
  { key: "devices", label: "Devices", align: "right", width: "80px", hideBelow: "lg" },
  { key: "last_sign_in_at", label: "Last sign-in", width: "130px" },
  { key: "created_at", label: "Joined", width: "130px", hideBelow: "md" },
];
</script>
<template>
  <div class="space-y-4">
    <AdminPageHead title="Users" subtitle="Search by email or user id. Newest first when the search is empty.">
      <form class="native-fields flex items-center gap-2" role="search" @submit.prevent="submit">
        <label for="users-q" class="sr-only">Search users</label>
        <input id="users-q" v-model="query" type="search" placeholder="email, id…" class="!w-64" autocomplete="off" />
        <AppButton type="submit" variant="primary" size="sm" :loading="q.loading.value">Search</AppButton>
      </form>
    </AdminPageHead>

    <AdminState :loading="q.loading.value" :error="q.error.value" :empty="q.loaded.value && rows.length === 0" :empty-text="query ? `No users match “${query}”.` : 'No users yet.'" @retry="q.reload">
      <AdminTable :columns="columns" :rows="rows" :row-key="(r) => r.id" :row-to="(r) => `/admin/users/${r.id}`" caption="Users">
        <template #cell-email="{ row }">
          <div class="font-medium">{{ row.email ?? "—" }}</div>
          <div class="font-mono text-xs text-muted">{{ row.id }}</div>
        </template>
        <template #cell-status="{ row }">
          <div class="flex flex-wrap gap-1">
            <AdminBadge v-if="row.disabled" text="disabled" tone="danger" />
            <AdminBadge v-else text="active" tone="ok" />
            <AdminBadge v-if="row.is_admin" text="admin" tone="accent" />
          </div>
        </template>
        <template #cell-entitlements="{ row }">
          <div v-if="row.entitlements?.length" class="flex flex-wrap gap-1"><AdminBadge v-for="e in row.entitlements" :key="e" :text="e" tone="ok" /></div>
          <span v-else class="text-muted">free</span>
        </template>
        <template #cell-devices="{ row }"><span class="tabular-nums">{{ adminFmt.int(row.devices) }}</span></template>
        <template #cell-last_sign_in_at="{ row }"><AdminTime :value="row.last_sign_in_at" /></template>
        <template #cell-created_at="{ row }"><AdminTime :value="row.created_at" /></template>
      </AdminTable>
      <AdminPager :page="page" :count="rows.length" :has-prev="page > 1" :has-next="!!next" :loading="q.loading.value" label="users" @prev="goPrev" @next="goNext" />
    </AdminState>
  </div>
</template>
