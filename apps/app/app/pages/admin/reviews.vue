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
const stars = (n: number) => { const k = Math.max(0, Math.min(5, Math.round(n))); return "★".repeat(k) + "☆".repeat(5 - k); };

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
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="m-0 text-xl font-semibold">Reviews</h1>
        <p class="m-0 text-sm text-muted">Approved reviews appear on the landing page. <template v-if="avg != null">Average in this view: {{ avg.toFixed(1) }} / 5.</template></p>
      </div>
      <div class="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Review status">
        <button v-for="s in statuses" :key="s.label" type="button" role="tab" :aria-selected="status === s.v" class="!rounded-md !border-0 !px-3 !py-1 text-sm" :class="status === s.v ? '!bg-accent !text-accent-ink' : '!bg-transparent text-muted hover:text-ink'" @click="status = s.v">{{ s.label }}</button>
      </div>
    </div>

    <AdminState :loading="q.loading.value" :error="q.error.value" :empty="q.loaded.value && reviews.length === 0" :empty-text="status ? `No ${status} reviews.` : 'No reviews yet.'" @retry="q.reload">
      <ul class="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
        <li v-for="r in reviews" :key="r.id" class="flex flex-col rounded-card border border-line bg-surface p-4">
          <div class="flex items-center gap-2">
            <span class="text-warn" :aria-label="`${r.rating} of 5 stars`">{{ stars(r.rating) }}</span>
            <AdminBadge :text="r.status" />
            <span class="ml-auto text-xs text-muted"><AdminTime :value="r.created_at" /></span>
          </div>
          <p class="m-0 mt-2 flex-1 whitespace-pre-wrap text-sm text-ink">{{ r.body || "(no text)" }}</p>
          <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <NuxtLink v-if="r.user_id" :to="`/admin/users/${r.user_id}`">{{ r.email ?? adminFmt.short(r.user_id) }}</NuxtLink>
            <span class="ml-auto flex gap-1">
              <button v-if="r.status !== 'approved'" type="button" class="!px-2 !py-0.5 text-xs" :disabled="!!action.busy.value" @click="setStatus(r.id, 'approved')">Approve</button>
              <button v-if="r.status !== 'rejected'" type="button" class="!px-2 !py-0.5 text-xs !text-danger" :disabled="!!action.busy.value" @click="setStatus(r.id, 'rejected')">Reject</button>
              <button v-if="r.status !== 'pending'" type="button" class="!px-2 !py-0.5 text-xs" :disabled="!!action.busy.value" @click="setStatus(r.id, 'pending')">Back to pending</button>
            </span>
          </div>
        </li>
      </ul>
    </AdminState>
  </div>
</template>
