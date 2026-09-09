<script setup lang="ts">
/** One support ticket: header, messages, reply box, close. Used by /admin/support. */
import type { AdminTicket, AdminTicketMessage } from "~/composables/useAdmin";

const props = defineProps<{ ticketId: string }>();
const emit = defineEmits<{ changed: [] }>();
const { api } = useAdmin();
const { confirm } = useAdminConfirm();
const action = useAdminAction();

const q = useAdminQuery(() => api.tickets.get(props.ticketId));
watch(() => props.ticketId, () => { reply.value = ""; void q.reload(); });

const ticket = computed<AdminTicket | null>(() => q.data.value?.ticket ?? null);
const messages = computed<AdminTicketMessage[]>(() => q.data.value?.messages ?? []);
const isClosed = computed(() => /closed|resolved/i.test(ticket.value?.status ?? ""));
const fromAdmin = (m: AdminTicketMessage) => m.from_admin === true || m.is_admin === true || m.role === "admin" || m.role === "agent";

const reply = ref("");
async function send() {
  const body = reply.value.trim();
  if (!body) return;
  await action.run("reply", () => api.tickets.reply(props.ticketId, body), "Reply sent.", async () => { reply.value = ""; await q.reload(); emit("changed"); });
}
async function close() {
  const r = await confirm({ title: "Close this ticket?", body: "The learner can still reply to reopen it.", confirmLabel: "Close ticket" });
  if (!r.ok) return;
  await action.run("close", () => api.tickets.close(props.ticketId), "Ticket closed.", async () => { await q.reload(); emit("changed"); });
}
</script>
<template>
  <AdminState :loading="q.loading.value" :error="q.error.value" :empty="!ticket" empty-text="Ticket not found." @retry="q.reload">
    <div v-if="ticket" class="flex h-full flex-col">
      <header class="border-b border-line pb-3">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="m-0 flex-1 text-[15px] font-semibold tracking-[-0.012em] text-ink">{{ ticket.subject }}</h2>
          <AdminBadge :text="ticket.status" />
          <AppButton v-if="!isClosed" variant="secondary" size="xs" :loading="action.busy.value === 'close'" @click="close">Close</AppButton>
        </div>
        <p class="m-0 mt-1.5 text-[11.5px] text-muted">
          <NuxtLink v-if="ticket.user_id" :to="`/admin/users/${ticket.user_id}`" class="text-accent underline underline-offset-2">
            {{ ticket.email ?? adminFmt.short(ticket.user_id) }}
          </NuxtLink>
          <span v-else>{{ ticket.email ?? "unknown user" }}</span>
          <span v-if="ticket.category"> · {{ ticket.category }}</span>
          · opened <AdminTime :value="ticket.created_at" />
        </p>
      </header>

      <ol class="m-0 flex-1 list-none space-y-2.5 overflow-y-auto p-0 py-3.5">
        <li v-if="!messages.length" class="text-[13.5px] text-muted">No messages returned for this ticket.</li>
        <li v-for="(m, i) in messages" :key="m.id ?? i" class="flex" :class="fromAdmin(m) ? 'justify-end' : 'justify-start'">
          <div
            class="max-w-[85%] rounded-card border px-3 py-2.5 text-[13.5px]"
            :class="fromAdmin(m) ? 'border-accent/25 bg-accent-soft' : 'border-line bg-surface-2'"
          >
            <div class="mb-1.5 flex items-center gap-2 text-[11.5px] text-muted">
              <strong class="font-semibold text-ink">{{ fromAdmin(m) ? "You (admin)" : "Learner" }}</strong>
              <AdminTime :value="m.created_at" />
            </div>
            <p class="m-0 whitespace-pre-wrap break-words leading-relaxed text-ink">{{ m.body }}</p>
          </div>
        </li>
      </ol>

      <form class="border-t border-line pt-3.5" @submit.prevent="send">
        <label class="sr-only" for="ticket-reply">Reply</label>
        <textarea
          id="ticket-reply"
          v-model="reply"
          rows="3"
          class="w-full resize-y rounded-card border border-line bg-paper p-2.5 text-[13.5px] leading-relaxed text-ink placeholder:text-muted/60 transition-colors focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/20"
          :placeholder="isClosed ? 'Replying reopens the ticket…' : 'Write a reply…'"
          @keydown.meta.enter.prevent="send"
          @keydown.ctrl.enter.prevent="send"
        />
        <div class="mt-2 flex items-center justify-between text-[11.5px] text-muted">
          <span>⌘/Ctrl + Enter to send</span>
          <AppButton
            type="submit"
            variant="primary"
            size="xs"
            :disabled="!reply.trim()"
            :loading="action.busy.value === 'reply'"
          >Send reply</AppButton>
        </div>
      </form>
    </div>
  </AdminState>
</template>
