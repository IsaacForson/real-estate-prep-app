<script setup lang="ts">
import { pushToast } from "~/components/Toast.vue";
/** Contact: new ticket form + the user's ticket threads with replies. */
useHead({ title: "Contact us" });
const auth = useAuth();
const support = useSupport();
const subject = ref("");
const body = ref("");
const category = ref("question");
const busy = ref(false);
const err = ref<string | null>(null);
const openId = ref<string | null>(null);
const replyText = ref("");
const categories = [
  { value: "question", label: "Question" }, { value: "content", label: "Wrong or outdated question" }, { value: "billing", label: "Billing / purchase" },
  { value: "account", label: "Account / devices" }, { value: "bug", label: "Something's broken" }, { value: "other", label: "Other" },
];
const statusTone = { open: "accent", answered: "ok", closed: "neutral" } as const;
const fmt = (s: string) => new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function create() {
  err.value = null;
  if (subject.value.trim().length < 3 || body.value.trim().length < 10) { err.value = "Give us a subject and at least a sentence of detail."; return; }
  busy.value = true;
  const t = await support.create(subject.value.trim(), body.value.trim(), category.value);
  busy.value = false;
  if (!t) { err.value = support.error.value ?? "Couldn't send. Try again."; return; }
  subject.value = ""; body.value = ""; openId.value = t.id; pushToast("Ticket sent. We'll reply here and by email.", "ok");
}
async function reply(id: string) {
  if (replyText.value.trim().length < 2) return;
  busy.value = true;
  const t = await support.reply(id, replyText.value.trim());
  busy.value = false;
  if (!t) { pushToast(support.error.value ?? "Couldn't send the reply.", "danger"); return; }
  replyText.value = "";
}
watch(() => auth.user.value?.id, (id) => { if (id) void support.load(); }, { immediate: true });
</script>
<template>
  <div class="safe-px anim-fade-up mx-auto grid max-w-3xl gap-6 py-8 md:py-14">
    <header class="grid gap-3">
      <p class="eyebrow">Contact</p>
      <h1 class="display text-[32px] md:text-[42px]">Talk to a person</h1>
      <p class="text-[15px] leading-relaxed text-ink-2">
        Every ticket is read by us, not a bot. Content reports go straight to the reviewer for that
        state.
      </p>
    </header>

    <AppCard v-if="!auth.signedIn.value">
      <EmptyState
        icon="mail"
        title="Sign in to open a ticket"
        body="Tickets are tied to your account so we can see your purchase and devices, and so replies reach you in the app."
        compact
      >
        <AppButton to="/signin?next=/help/contact" variant="primary" size="sm">Sign in</AppButton>
        <AppButton to="/help" variant="ghost" size="sm">Search help instead</AppButton>
      </EmptyState>
    </AppCard>

    <template v-else>
      <AppCard title="New ticket">
        <form class="grid gap-4" novalidate @submit.prevent="create">
          <AppInput v-model="category" label="Topic" :options="categories" />
          <AppInput v-model="subject" label="Subject" placeholder="Short summary" :maxlength="120" required />
          <AppInput
            v-model="body"
            label="Details"
            multiline
            :rows="5"
            placeholder="For a content report, include the question's ID (shown under the citation) and what you think is wrong."
            :maxlength="4000"
            :error="err"
            required
          />
          <AppButton type="submit" variant="primary" size="lg" :loading="busy" class="justify-self-start">Send</AppButton>
        </form>
      </AppCard>

      <section class="grid gap-2">
        <h2 class="eyebrow px-1">Your tickets</h2>
        <EmptyState v-if="!support.tickets.value.length" icon="message" title="No tickets yet" compact />

        <article v-for="t in support.tickets.value" :key="t.id" class="overflow-hidden rounded-card border border-line bg-surface">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
            :aria-expanded="openId === t.id"
            @click="openId = openId === t.id ? null : t.id"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[15px] font-medium">{{ t.subject }}</span>
              <span class="block text-[11.5px] text-muted">{{ fmt(t.updated_at ?? t.created_at) }} · {{ t.category ?? 'general' }}</span>
            </span>
            <Badge :tone="statusTone[t.status as keyof typeof statusTone] ?? 'neutral'">{{ t.status }}</Badge>
            <Icon
              name="chevron-down"
              :size="17"
              class="shrink-0 text-muted transition-transform duration-200 ease-standard"
              :class="openId === t.id ? 'rotate-180' : ''"
            />
          </button>

          <div v-if="openId === t.id" class="grid gap-3 border-t border-line bg-paper px-4 py-4">
            <!-- Support replies sit left in an accent tint, the learner's own messages right on
                 surface: the same asymmetry every messaging app uses, so no legend is needed. -->
            <div
              v-for="m in t.messages ?? []"
              :key="m.id"
              class="max-w-[85%] whitespace-pre-line rounded-panel px-3.5 py-2.5 text-[13.5px] leading-relaxed"
              :class="m.author === 'admin' ? 'self-start rounded-tl-sm bg-accent-soft text-ink' : 'self-end rounded-tr-sm border border-line bg-surface'"
            >
              <p class="mb-1 text-[11px] text-muted">{{ m.author === 'admin' ? 'Support' : 'You' }} · {{ fmt(m.created_at) }}</p>{{ m.body }}
            </div>

            <form v-if="t.status !== 'closed'" class="flex items-end gap-2" @submit.prevent="reply(t.id)">
              <AppInput v-model="replyText" multiline :rows="2" placeholder="Reply…" class="flex-1" aria-label="Reply" />
              <AppButton type="submit" variant="primary" :loading="busy" :disabled="replyText.trim().length < 2">Send</AppButton>
            </form>
            <p v-else class="text-[12px] text-muted">This ticket is closed. Open a new one if anything else comes up.</p>
          </div>
        </article>
      </section>
    </template>
  </div>
</template>
