<script setup lang="ts">
/**
 * The statute citation on every answer: source, verbatim quote, official link, optional secondary
 * authorities.
 *
 * This is the product's signature surface — the citation chain is the whole defensibility argument
 * (SPEC §3.5), so it is the one place the serif face is used. Quoted law is set upright in serif on
 * `paper`, deliberately unlike every other block of UI text, so a learner can tell at a glance
 * where our writing stops and the statute begins.
 */
withDefaults(defineProps<{
  source: string;
  quote: string;
  url?: string | null;
  secondary?: Array<{ source: string; url: string | null }>;
  compact?: boolean;
}>(), { url: null, secondary: () => [], compact: false });
</script>
<template>
  <figure class="overflow-hidden rounded-card border border-line bg-paper">
    <figcaption class="flex items-start justify-between gap-3 border-b border-line px-3.5 py-2.5">
      <div class="flex min-w-0 items-center gap-2">
        <span
          class="grid size-5 shrink-0 place-items-center rounded-[6px] bg-action font-serif text-[13px] leading-none text-action-ink"
          aria-hidden="true"
        >§</span>
        <span class="min-w-0 break-words text-[13.5px] font-semibold leading-snug text-ink">{{ source }}</span>
      </div>
      <a
        v-if="url"
        :href="url"
        target="_blank"
        rel="noopener"
        class="-my-1.5 -mr-1 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1.5 text-[12.5px] font-medium text-accent transition-colors hover:bg-accent-soft"
        aria-label="Open the cited section (opens in a new tab)"
      >Open <Icon name="external" :size="13" /></a>
    </figcaption>

    <blockquote class="statute px-3.5 py-3 text-ink-2" :class="compact ? 'line-clamp-3 text-[15px]' : ''">
      <span class="text-muted" aria-hidden="true">“</span>{{ quote }}<span class="text-muted" aria-hidden="true">”</span>
    </blockquote>

    <p v-if="secondary.length" class="border-t border-line px-3.5 py-2 text-[12px] text-muted">
      Also:
      <template v-for="(s, i) in secondary" :key="s.source">
        <a v-if="s.url" :href="s.url" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-ink-2">{{ s.source }}</a>
        <span v-else>{{ s.source }}</span><span v-if="i < secondary.length - 1">, </span>
      </template>
    </p>
  </figure>
</template>
