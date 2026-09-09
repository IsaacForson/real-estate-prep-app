<script setup lang="ts">
import { pushToast } from "~/components/Toast.vue";
/** Help Center: KB search, browse by topic, and an AI answer grounded on the KB when nothing matches. */
useHead({ title: "Help Center" });
const help = useHelp();
const auth = useAuth();
const events = useEvents();
const route = useRoute();
const q = ref(typeof route.query.q === "string" ? route.query.q : "");
const asking = ref(false);
const ai = ref<{ answer: string; sources: string[] } | null>(null);
const aiError = ref<string | null>(null);

const results = computed(() => help.search(q.value.trim(), 12));
onMounted(() => { void help.load(); });
const all = computed(() => help.kb.value);
const topics = computed(() => {
  const m = new Map<string, number>();
  for (const a of all.value) m.set(a.section ?? "General", (m.get(a.section ?? "General") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
});
let t: ReturnType<typeof setTimeout> | null = null;
watch(q, (v) => { ai.value = null; aiError.value = null; if (t) clearTimeout(t); if (v.trim().length > 2) t = setTimeout(() => events.track("help_search", { q: v.trim(), results: results.value.length }), 600); });

async function ask() {
  if (!q.value.trim()) return;
  if (!auth.signedIn.value) { await navigateTo(`/signin?next=${encodeURIComponent(`/help?q=${encodeURIComponent(q.value)}`)}`); return; }
  asking.value = true; aiError.value = null;
  try { ai.value = await help.ask(q.value.trim()); }
  catch (e) { aiError.value = (e as Error)?.message ?? "The assistant is unavailable right now."; pushToast("Couldn't reach the assistant.", "warn"); }
  finally { asking.value = false; }
}
const quick = ["How is the readiness score computed?", "Is this a subscription?", "Which national bank do I study?", "How do I restore my purchase?", "How many devices can I use?"];
</script>
<template>
  <div class="max-w-3xl mx-auto safe-px py-6 md:py-12 grid gap-6 anim-fade-up">
    <header class="grid gap-2">
      <p class="eyebrow text-accent">Help Center</p>
      <h1 class="text-3xl md:text-4xl display">How can we help?</h1>
      <p class="text-ink-2">Answers come from the same documents we build the product from. Nothing here is written by marketing.</p>
    </header>
    <AppInput v-model="q" type="search" placeholder="Search the help center" inputmode="search" autocomplete="off" aria-label="Search the help center" autofocus />

    <template v-if="q.trim()">
      <section v-if="results.length" class="grid gap-2">
        <p class="text-xs text-muted px-1 tabular">{{ results.length }} article{{ results.length === 1 ? '' : 's' }}</p>
        <NuxtLink v-for="a in results" :key="a.id" :to="`/help/${a.id}`" class="rounded-card bg-surface border border-line px-4 py-3 flex items-center gap-3 hover:bg-surface-2">
          <span class="flex-1 min-w-0"><span class="block font-medium text-[15px] truncate">{{ a.title }}</span><span class="block text-xs text-muted">{{ a.section ?? 'General' }}</span></span>
          <Icon name="chevron-right" :size="18" class="text-muted" />
        </NuxtLink>
      </section>
      <AppCard :tone="results.length ? 'paper' : 'default'">
        <div class="flex items-start gap-3">
          <span class="grid place-items-center size-10 rounded-xl bg-accent-soft text-accent shrink-0"><Icon name="spark" :size="20" /></span>
          <div class="flex-1 grid gap-2 min-w-0">
            <p class="font-semibold">{{ results.length ? "Didn't find it? Ask." : 'No articles match. Ask instead.' }}</p>
            <p class="text-sm text-muted">The assistant answers only from our help articles and product docs. It can be wrong; it is not legal advice and never a substitute for your state's statute or candidate bulletin. Every question is logged so we can write the missing article.</p>
            <div v-if="ai" class="rounded-xl bg-surface border border-line p-3 grid gap-2 text-sm">
              <p class="whitespace-pre-line text-ink-2">{{ ai.answer }}</p>
              <p v-if="ai.sources.length" class="text-xs text-muted">Sources: <template v-for="(s, i) in ai.sources" :key="s"><NuxtLink :to="`/help/${s}`" class="underline underline-offset-2">{{ s }}</NuxtLink><span v-if="i < ai.sources.length - 1">, </span></template></p>
              <p class="text-xs text-muted">Not what you needed? <NuxtLink to="/help/contact" class="text-accent font-medium">Contact us</NuxtLink> — a person answers.</p>
            </div>
            <p v-if="aiError" class="text-sm text-danger">{{ aiError }}</p>
            <AppButton v-if="!ai" variant="primary" size="sm" :loading="asking" icon="spark" class="justify-self-start" @click="ask">{{ auth.signedIn.value ? 'Ask the assistant' : 'Sign in to ask' }}</AppButton>
          </div>
        </div>
      </AppCard>
    </template>

    <template v-else>
      <section class="grid gap-2">
        <h2 class="eyebrow px-1">Common questions</h2>
        <div class="flex flex-wrap gap-2">
          <button v-for="s in quick" :key="s" type="button" class="min-h-10 px-3.5 rounded-pill bg-surface border border-line text-sm hover:bg-surface-2 text-left" @click="q = s">{{ s }}</button>
        </div>
      </section>
      <section v-if="topics.length" class="grid gap-2">
        <h2 class="eyebrow px-1">Browse</h2>
        <div class="grid sm:grid-cols-2 gap-2">
          <button v-for="[cat, n] in topics" :key="cat" type="button" class="rounded-card bg-surface border border-line px-4 py-3 flex items-center gap-3 text-left hover:bg-surface-2" @click="q = cat">
            <span class="flex-1 font-medium text-[15px]">{{ cat }}</span><Badge tone="neutral">{{ n }}</Badge><Icon name="chevron-right" :size="18" class="text-muted" />
          </button>
        </div>
      </section>
      <EmptyState v-else icon="help" title="Articles are on their way" body="The knowledge base is generated from our docs at build time. Search above or contact us." compact />
      <AppCard tone="paper">
        <div class="flex items-center gap-3">
          <span class="grid place-items-center size-10 rounded-xl bg-surface-2 text-ink-2"><Icon name="message" :size="20" /></span>
          <div class="flex-1"><p class="font-semibold">Still stuck?</p><p class="text-sm text-muted">Open a ticket. A person reads every one.</p></div>
          <AppButton to="/help/contact" variant="secondary" size="sm">Contact us</AppButton>
        </div>
      </AppCard>
    </template>
  </div>
</template>
