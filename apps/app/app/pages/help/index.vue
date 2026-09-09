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
  <div class="safe-px anim-fade-up mx-auto grid max-w-3xl gap-6 py-8 md:py-14">
    <header class="grid gap-3">
      <p class="eyebrow">Help Center</p>
      <h1 class="display text-[32px] md:text-[42px]">How can we help?</h1>
      <p class="text-[15px] leading-relaxed text-ink-2">
        Answers come from the same documents we build the product from. Nothing here is written by
        marketing.
      </p>
    </header>

    <AppInput
      v-model="q"
      type="search"
      placeholder="Search the help center"
      inputmode="search"
      autocomplete="off"
      aria-label="Search the help center"
      autofocus
    />

    <template v-if="q.trim()">
      <section v-if="results.length" class="grid gap-2">
        <p class="tabular px-1 text-[11.5px] text-muted" aria-live="polite">{{ results.length }} article{{ results.length === 1 ? '' : 's' }}</p>
        <NuxtLink
          v-for="a in results"
          :key="a.id"
          :to="`/help/${a.id}`"
          class="flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong hover:bg-surface-2"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[15px] font-medium">{{ a.title }}</span>
            <span class="block text-[11.5px] text-muted">{{ a.section ?? 'General' }}</span>
          </span>
          <Icon name="chevron-right" :size="17" class="shrink-0 text-muted" />
        </NuxtLink>
      </section>

      <!-- The assistant is offered after the articles, never instead of them: a cited article is a
           better answer than a generated one. -->
      <AppCard :tone="results.length ? 'paper' : 'default'">
        <div class="flex items-start gap-3.5">
          <span class="grid size-10 shrink-0 place-items-center rounded-card bg-accent-soft text-accent">
            <Icon name="spark" :size="19" />
          </span>
          <div class="grid min-w-0 flex-1 gap-2.5">
            <p class="text-[15px] font-semibold">{{ results.length ? "Didn't find it? Ask." : 'No articles match. Ask instead.' }}</p>
            <p class="text-[13px] leading-relaxed text-muted">
              The assistant answers only from our help articles and product docs. It can be wrong; it
              is not legal advice and never a substitute for your state's statute or candidate
              bulletin. Every question is logged so we can write the missing article.
            </p>

            <div v-if="ai" class="grid gap-2.5 rounded-card border border-line bg-surface p-3.5">
              <p class="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{{ ai.answer }}</p>
              <p v-if="ai.sources.length" class="text-[11.5px] text-muted">
                Sources:
                <template v-for="(s, i) in ai.sources" :key="s">
                  <NuxtLink :to="`/help/${s}`" class="underline underline-offset-2 hover:text-ink-2">{{ s }}</NuxtLink><span v-if="i < ai.sources.length - 1">, </span>
                </template>
              </p>
              <p class="text-[11.5px] text-muted">
                Not what you needed?
                <NuxtLink to="/help/contact" class="font-medium text-accent hover:underline hover:underline-offset-4">Contact us</NuxtLink>
                — a person answers.
              </p>
            </div>

            <p v-if="aiError" class="text-[13px] text-danger" role="alert">{{ aiError }}</p>
            <AppButton
              v-if="!ai"
              variant="primary"
              size="sm"
              :loading="asking"
              icon="spark"
              class="justify-self-start"
              @click="ask"
            >{{ auth.signedIn.value ? 'Ask the assistant' : 'Sign in to ask' }}</AppButton>
          </div>
        </div>
      </AppCard>
    </template>

    <template v-else>
      <section class="grid gap-2.5">
        <h2 class="eyebrow px-1">Common questions</h2>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="s in quick"
            :key="s"
            type="button"
            class="min-h-10 rounded-pill border border-line bg-surface px-3.5 text-left text-[13px] transition-colors hover:border-line-strong hover:bg-surface-2"
            @click="q = s"
          >{{ s }}</button>
        </div>
      </section>

      <section v-if="topics.length" class="grid gap-2.5">
        <h2 class="eyebrow px-1">Browse</h2>
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            v-for="[cat, n] in topics"
            :key="cat"
            type="button"
            class="flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-surface-2"
            @click="q = cat"
          >
            <span class="flex-1 text-[15px] font-medium">{{ cat }}</span>
            <Badge tone="neutral">{{ n }}</Badge>
            <Icon name="chevron-right" :size="17" class="text-muted" />
          </button>
        </div>
      </section>
      <EmptyState
        v-else
        icon="help"
        title="Articles are on their way"
        body="The knowledge base is generated from our docs at build time. Search above or contact us."
        compact
      />

      <AppCard tone="paper">
        <div class="flex items-center gap-3.5">
          <span class="grid size-10 shrink-0 place-items-center rounded-card bg-surface-2 text-ink-2">
            <Icon name="message" :size="19" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[15px] font-semibold leading-tight">Still stuck?</p>
            <p class="mt-0.5 text-[13px] text-muted">Open a ticket. A person reads every one.</p>
          </div>
          <AppButton to="/help/contact" variant="secondary" size="sm">Contact us</AppButton>
        </div>
      </AppCard>
    </template>
  </div>
</template>
