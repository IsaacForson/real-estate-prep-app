<script setup lang="ts">
definePageMeta({ layout: "admin", ssr: false });
useHead({ title: "Support · Admin" });

const { api, requireAdmin } = useAdmin();
const route = useRoute();
const router = useRouter();

const statuses = [
  { v: "open", label: "Open" }, { v: "answered", label: "Answered" }, { v: "closed", label: "Closed" }, { v: null, label: "All" },
];
const status = ref<string | null>(typeof route.query.status === "string" ? route.query.status : "open");
const cursors = ref<Array<string | null>>([null]);
const page = ref(1);
const next = ref<string | null>(null);

const q = useAdminQuery(async () => {
  const r = await api.tickets.list(status.value, cursors.value[page.value - 1] ?? null);
  next.value = r.next;
  return r.tickets;
});
onMounted(() => { void requireAdmin(); });
watch(status, (s) => { cursors.value = [null]; page.value = 1; void router.replace({ query: { ...route.query, status: s ?? undefined } }); void q.reload(); });
function goNext() { if (!next.value) return; cursors.value = [...cursors.value.slice(0, page.value), next.value]; page.value += 1; void q.reload(); }
function goPrev() { if (page.value <= 1) return; page.value -= 1; void q.reload(); }

const selected = computed(() => (typeof route.query.id === "string" ? route.query.id : null));
function select(id: string | null) { void router.replace({ query: { ...route.query, id: id ?? undefined } }); }
const tickets = computed(() => q.data.value ?? []);
</script>
<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="m-0 text-xl font-semibold">Support</h1>
        <p class="m-0 text-sm text-muted">Tickets from “Contact us”. Replies are emailed to the learner and shown in their Help Center.</p>
      </div>
      <div class="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Ticket status">
        <button v-for="s in statuses" :key="s.label" type="button" role="tab" :aria-selected="status === s.v" class="!rounded-md !border-0 !px-3 !py-1 text-sm" :class="status === s.v ? '!bg-accent !text-accent-ink' : '!bg-transparent text-muted hover:text-ink'" @click="status = s.v">{{ s.label }}</button>
      </div>
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(320px,2fr)_3fr]">
      <div>
        <AdminState :loading="q.loading.value" :error="q.error.value" :empty="q.loaded.value && tickets.length === 0" :empty-text="status ? `No ${status} tickets.` : 'No tickets yet.'" @retry="q.reload">
          <ul class="m-0 list-none divide-y divide-line overflow-hidden rounded-card border border-line bg-surface p-0" role="listbox" aria-label="Tickets">
            <li v-for="t in tickets" :key="t.id">
              <button
                type="button"
                role="option"
                :aria-selected="selected === t.id"
                class="block w-full !rounded-none !border-0 !bg-transparent !px-3 !py-2.5 text-left hover:!bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                :class="selected === t.id ? '!bg-surface-2' : ''"
                @click="select(t.id)"
              >
                <div class="flex items-center gap-2">
                  <span class="flex-1 truncate text-sm font-medium text-ink">{{ t.subject }}</span>
                  <AdminBadge :text="t.status" />
                </div>
                <div class="mt-0.5 flex items-center gap-2 text-xs text-muted">
                  <span class="truncate">{{ t.email ?? adminFmt.short(t.user_id ?? undefined) }}</span>
                  <span v-if="t.category">· {{ t.category }}</span>
                  <span class="ml-auto"><AdminTime :value="t.last_message_at ?? t.updated_at ?? t.created_at" /></span>
                </div>
              </button>
            </li>
          </ul>
          <AdminPager :page="page" :count="tickets.length" :has-prev="page > 1" :has-next="!!next" :loading="q.loading.value" label="tickets" @prev="goPrev" @next="goNext" />
        </AdminState>
      </div>

      <AdminCard class="min-h-[420px]">
        <AdminTicketThread v-if="selected" :ticket-id="selected" @changed="q.reload" />
        <div v-else class="flex h-full min-h-[360px] items-center justify-center text-sm text-muted">Select a ticket to read the thread.</div>
      </AdminCard>
    </div>
  </div>
</template>
