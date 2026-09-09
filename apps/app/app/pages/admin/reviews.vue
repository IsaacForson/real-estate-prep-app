<script setup lang="ts">
definePageMeta({ layout: "admin", ssr: false });
useHead({ title: "Reviews · Admin" });

const { api, requireAdmin } = useAdmin();
const { confirm } = useAdminConfirm();
const action = useAdminAction();

const statuses = [{ v: "pending", label: "Pending" }, { v: "approved", label: "Approved" }, { v: "rejected", label: "Rejected" }, { v: null, label: "All" }];
const status = ref<string | null>("pending");
const q = useAdminQuery(() => api.reviews.list(status.value));
watch(status, () => { void q.reload(); });
onMounted(() => { void requireAdmin(); });

const reviews = computed(() => q.data.value ?? []);
const avg = computed(() => (reviews.value.length ? reviews.value.reduce((s, r) => s + (r.rating ?? 0), 0) / reviews.value.length : null));
const filters = statuses.map((s) => ({ value: s.v ?? "all", label: s.label }));
const filter = computed({ get: () => status.value ?? "all", set: (v: string) => { status.value = v === "all" ? null : v; } });

async function setStatus(id: string, s: "approved" | "rejected" | "pending") {
  if (s === "rejected") {
    const r = await confirm({ title: "Reject this review?", body: "It stays in the database but never shows on the landing page.", confirmLabel: "Reject", danger: true });
    if (!r.ok) return;
  }
  await action.run(`${s}-${id}`, () => api.reviews.setStatus(id, s), `Review ${s}.`, q.reload);
}
</script>
<template>
  <div class="space-y-4">
    <AdminPageHead
      title="Reviews"
      :subtitle="`Approved reviews appear on the landing page.${avg != null ? ` Average in this view: ${avg.toFixed(1)} / 5.` : ''}`"
    >
      <AdminSegmented v-model="filter" :options="filters" aria-label="Review status" />
    </AdminPageHead>

    <AdminState
      :loading="q.loading.value"
      :error="q.error.value"
      :empty="q.loaded.value && reviews.length === 0"
      :empty-text="status ? `No ${status} reviews.` : 'No reviews yet.'"
      @retry="q.reload"
    >
      <ul class="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
        <li v-for="r in reviews" :key="r.id" class="flex flex-col rounded-card border border-line bg-surface p-4">
          <div class="flex items-center gap-2">
            <span class="inline-flex text-warn" :aria-label="`${r.rating} of 5 stars`">
              <Icon v-for="n in 5" :key="n" :name="n <= r.rating ? 'star-filled' : 'star'" :size="14" :class="n <= r.rating ? '' : 'text-line-strong'" />
            </span>
            <AdminBadge :text="r.status" />
            <span class="ml-auto text-[11.5px] text-muted"><AdminTime :value="r.created_at" /></span>
          </div>

          <p class="m-0 mt-2.5 flex-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{{ r.body || "(no text)" }}</p>

          <div class="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <NuxtLink
              v-if="r.user_id"
              :to="`/admin/users/${r.user_id}`"
              class="truncate text-[12px] text-muted hover:text-ink"
            >{{ r.email ?? adminFmt.short(r.user_id) }}</NuxtLink>
            <span class="ml-auto flex gap-1">
              <AppButton v-if="r.status !== 'approved'" variant="secondary" size="xs" :disabled="!!action.busy.value" @click="setStatus(r.id, 'approved')">Approve</AppButton>
              <AppButton v-if="r.status !== 'rejected'" variant="ghost" size="xs" class="!text-danger" :disabled="!!action.busy.value" @click="setStatus(r.id, 'rejected')">Reject</AppButton>
              <AppButton v-if="r.status !== 'pending'" variant="ghost" size="xs" :disabled="!!action.busy.value" @click="setStatus(r.id, 'pending')">Back to pending</AppButton>
            </span>
          </div>
        </li>
      </ul>
    </AdminState>
  </div>
</template>
