<script setup lang="ts">
/** The statute citation on every answer: source, verbatim quote, official link, optional secondary authorities. */
withDefaults(defineProps<{
  source: string;
  quote: string;
  url?: string | null;
  secondary?: Array<{ source: string; url: string | null }>;
  compact?: boolean;
}>(), { url: null, secondary: () => [], compact: false });
</script>
<template>
  <figure class="rounded-xl border-l-[3px] border-accent bg-accent-soft/60 pl-4 pr-3 py-3">
    <figcaption class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-2 min-w-0">
        <span class="shrink-0 grid place-items-center size-6 rounded-md bg-accent text-accent-ink font-serif text-[15px] leading-none" aria-hidden="true">§</span>
        <span class="font-semibold text-[15px] text-ink leading-snug break-words">{{ source }}</span>
      </div>
      <a v-if="url" :href="url" target="_blank" rel="noopener" class="tap -my-2 -mr-1 inline-flex items-center gap-1 text-accent text-sm font-medium shrink-0" aria-label="Open the cited section (opens in a new tab)">
        Open <Icon name="external" :size="15" />
      </a>
    </figcaption>
    <blockquote class="mt-2 text-ink-2 font-serif italic leading-relaxed" :class="compact ? 'text-sm line-clamp-3' : 'text-[15px]'">“{{ quote }}”</blockquote>
    <p v-if="secondary.length" class="mt-2 text-xs text-muted">
      Also: <template v-for="(s, i) in secondary" :key="s.source"><a v-if="s.url" :href="s.url" target="_blank" rel="noopener" class="underline underline-offset-2">{{ s.source }}</a><span v-else>{{ s.source }}</span><span v-if="i < secondary.length - 1">, </span></template>
    </p>
  </figure>
</template>
