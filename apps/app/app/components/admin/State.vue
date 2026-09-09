<script setup lang="ts">
/**
 * Loading / error / empty wrapper for admin queries. Shows the slot only when data is present.
 * `error` is an AdminError so the message and `code` from the function are shown verbatim — an
 * operator debugging a failing endpoint needs the real code, not a friendly paraphrase.
 */
import type { AdminError } from "~/composables/useAdmin";

const props = withDefaults(defineProps<{
  loading?: boolean;
  error?: AdminError | null;
  empty?: boolean;
  emptyText?: string;
  loadingText?: string;
  inline?: boolean;
}>(), { emptyText: "Nothing here yet.", loadingText: "Loading…" });
const emit = defineEmits<{ retry: [] }>();
const detail = computed(() => (props.error ? describeAdminError(props.error) : ""));
</script>
<template>
  <div v-if="error" role="alert" class="rounded-card border border-danger/30 bg-danger-soft p-4 text-[13.5px] text-ink">
    <div class="flex items-center gap-2 font-medium text-danger">
      <Icon name="alert" :size="16" />Couldn't load
    </div>
    <p class="m-0 mt-1.5 leading-relaxed">{{ detail }}</p>
    <p v-if="detail !== error.message" class="m-0 mt-1 text-muted">{{ error.message }}</p>
    <div class="mt-3 flex items-center gap-3">
      <code class="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-muted">
        code: {{ error.code }}<template v-if="error.status"> · http {{ error.status }}</template>
      </code>
      <AppButton variant="secondary" size="xs" icon="refresh" @click="emit('retry')">Retry</AppButton>
    </div>
  </div>

  <div
    v-else-if="loading && empty"
    class="flex items-center gap-2 text-[13.5px] text-muted"
    :class="inline ? '' : 'rounded-card border border-dashed border-line p-6'"
    aria-busy="true"
  >
    <span class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />{{ loadingText }}
  </div>

  <div
    v-else-if="empty"
    class="text-[13.5px] text-muted"
    :class="inline ? '' : 'rounded-card border border-dashed border-line p-6 text-center'"
  >{{ emptyText }}</div>

  <!--
    `space-y-5` is load-bearing: several pages put a KPI grid and a card grid in this slot as
    siblings, and the grids' own `gap` does nothing between them. Without it the tiles sit flush
    against the cards below. Single-child callers (the common case) are unaffected.
  -->
  <div v-else class="space-y-5" :class="loading ? 'opacity-55 transition-opacity' : ''" :aria-busy="loading ? 'true' : undefined"><slot /></div>
</template>
