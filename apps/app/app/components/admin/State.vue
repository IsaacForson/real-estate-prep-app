<script setup lang="ts">
/**
 * Loading / error / empty wrapper for admin queries. Shows the slot only when data is present.
 * `error` is an AdminError so the message and `code` from the function are shown verbatim.
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
  <div v-if="error" role="alert" class="rounded-card border border-danger/40 bg-danger/10 p-4 text-sm text-ink">
    <div class="font-medium text-danger">Couldn't load</div>
    <p class="m-0 mt-1">{{ detail }}</p>
    <p v-if="detail !== error.message" class="m-0 mt-1 text-muted">{{ error.message }}</p>
    <div class="mt-2 flex items-center gap-3">
      <code class="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">code: {{ error.code }}<template v-if="error.status"> · http {{ error.status }}</template></code>
      <button type="button" class="!px-3 !py-1 text-sm" @click="emit('retry')">Retry</button>
    </div>
  </div>
  <div v-else-if="loading && empty" class="flex items-center gap-2 text-sm text-muted" :class="inline ? '' : 'rounded-card border border-dashed border-line p-6'" aria-busy="true">
    <span class="inline-block size-3 animate-pulse rounded-full bg-accent" aria-hidden="true" />{{ loadingText }}
  </div>
  <div v-else-if="empty" class="text-sm text-muted" :class="inline ? '' : 'rounded-card border border-dashed border-line p-6 text-center'">{{ emptyText }}</div>
  <div v-else :class="loading ? 'opacity-60 transition-opacity' : ''" :aria-busy="loading ? 'true' : undefined"><slot /></div>
</template>
