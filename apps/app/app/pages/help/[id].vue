<script setup lang="ts">
/** One help article. Body is Markdown-ish plain text rendered as paragraphs (no HTML from the KB). */
const route = useRoute();
const help = useHelp();
const id = computed(() => String(route.params.id));
const article = computed(() => help.byId(id.value));
const related = computed(() => (article.value ? help.kb.value.filter((a) => a.id !== id.value && a.section === article.value!.section).slice(0, 4) : []));
onMounted(() => { void help.load(); });
useHead({ title: computed(() => article.value ? `${article.value.title} — Help` : "Help") });
const blocks = computed(() => (article.value?.body ?? "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean));
function kind(b: string) { return /^#{1,3}\s/.test(b) ? "h" : /^(-|\*|\d+\.)\s/m.test(b) ? "list" : "p"; }
const listItems = (b: string) => b.split(/\n/).map((l) => l.replace(/^(-|\*|\d+\.)\s+/, "").trim()).filter(Boolean);
</script>
<template>
  <div class="safe-px anim-fade-up mx-auto grid max-w-3xl gap-6 py-8 md:py-14">
    <NuxtLink to="/help" class="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline hover:underline-offset-4">
      <Icon name="arrow-left" :size="15" />Help Center
    </NuxtLink>

    <template v-if="article">
      <header class="grid gap-2.5">
        <p class="eyebrow">{{ article.section ?? 'General' }}</p>
        <h1 class="display text-[30px] md:text-[38px]">{{ article.title }}</h1>
      </header>

      <article class="rich grid gap-3 text-[15.5px] leading-relaxed text-ink-2">
        <template v-for="(b, i) in blocks" :key="i">
          <h2 v-if="kind(b) === 'h'" class="!mt-2 text-ink">{{ b.replace(/^#+\s*/, '') }}</h2>
          <ul v-else-if="kind(b) === 'list'"><li v-for="li in listItems(b)" :key="li">{{ li }}</li></ul>
          <p v-else>{{ b }}</p>
        </template>
      </article>

      <AppCard tone="paper">
        <div class="flex flex-wrap items-center gap-3">
          <p class="flex-1 text-[13.5px] text-ink-2">Didn't answer it? A person will.</p>
          <AppButton to="/help/contact" variant="secondary" size="sm" icon="message">Contact us</AppButton>
        </div>
      </AppCard>

      <section v-if="related.length" class="grid gap-2">
        <h2 class="eyebrow px-1">Related</h2>
        <NuxtLink
          v-for="a in related"
          :key="a.id"
          :to="`/help/${a.id}`"
          class="flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong hover:bg-surface-2"
        >
          <span class="flex-1 text-[15px] font-medium">{{ a.title }}</span>
          <Icon name="chevron-right" :size="17" class="text-muted" />
        </NuxtLink>
      </section>
    </template>

    <Skeleton v-else-if="!help.loaded.value" :lines="6" />
    <EmptyState v-else icon="help" title="Article not found" body="It may have moved. Search the help center instead.">
      <AppButton to="/help" variant="primary" size="sm">Search</AppButton>
    </EmptyState>
  </div>
</template>
