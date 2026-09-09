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
// The segmented control speaks strings; "all" is this page's name for "no status filter".
const filters = statuses.map((s) => ({ value: s.v ?? "all", label: s.label }));
const filter = computed({ get: () => status.value ?? "all", set: (v: string) => { status.value = v === "all" ? null : v; } });
</script>
<template>
  <div class="space-y-4">
    <AdminPageHead
      title="Support"
      subtitle="Tickets from “Contact us”. Replies are emailed to the learner and shown in their Help Center."
    >
      <AdminSegmented v-model="filter" :options="filters" aria-label="Ticket status" />
    </AdminPageHead>

    <!-- List beside thread: triaging a queue means reading one ticket without losing your place. -->
    <div class="grid gap-4 xl:grid-cols-[minmax(320px,2fr)_3fr]">
      <div>
        <AdminState
          :loading="q.loading.value"
          :error="q.error.value"
          :empty="q.loaded.value && tickets.length === 0"
          :empty-text="status ? `No ${status} tickets.` : 'No tickets yet.'"
          @retry="q.reload"
        >
          <ul class="m-0 list-none overflow-hidden rounded-card border border-line bg-surface p-0" role="listbox" aria-label="Tickets">
            <li v-for="t in tickets" :key="t.id" class="border-b border-line last:border-b-0">
              <button
                type="button"
                role="option"
                :aria-selected="selected === t.id"
                class="relative block w-full px-3.5 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:-outline-offset-2"
                :class="selected === t.id ? 'bg-surface-2' : ''"
                @click="select(t.id)"
              >
                <span v-if="selected === t.id" class="absolute inset-y-0 left-0 w-[3px] bg-accent" aria-hidden="true" />
                <span class="flex items-center gap-2">
                  <span class="flex-1 truncate text-[13.5px] font-medium text-ink">{{ t.subject }}</span>
                  <AdminBadge :text="t.status" />
                </span>
                <span class="mt-1 flex items-center gap-2 text-[11.5px] text-muted">
                  <span class="truncate">{{ t.email ?? adminFmt.short(t.user_id ?? undefined) }}</span>
                  <span v-if="t.category">· {{ t.category }}</span>
                  <span class="ml-auto shrink-0"><AdminTime :value="t.last_message_at ?? t.updated_at ?? t.created_at" /></span>
                </span>
              </button>
            </li>
          </ul>
          <AdminPager :page="page" :count="tickets.length" :has-prev="page > 1" :has-next="!!next" :loading="q.loading.value" label="tickets" @prev="goPrev" @next="goNext" />
        </AdminState>
      </div>

      <AdminCard class="min-h-[420px]">
        <AdminTicketThread v-if="selected" :ticket-id="selected" @changed="q.reload" />
        <div v-else class="grid h-full min-h-[360px] place-items-center">
          <div class="grid justify-items-center gap-2 text-muted">
            <Icon name="message" :size="26" />
            <p class="m-0 text-[13px]">Select a ticket to read the thread.</p>
          </div>
        </div>
      </AdminCard>
    </div>
  </div>
</template>
