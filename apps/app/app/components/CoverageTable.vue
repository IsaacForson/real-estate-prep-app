<script setup lang="ts">
import type { NodeCoverage } from "~~/lib/study/coverage";
/** Coverage per exam section as a stacked list (works on a phone; no horizontal table). */
const props = withDefaults(defineProps<{ rows: NodeCoverage[]; selectable?: boolean; limit?: number }>(), { selectable: false, limit: 0 });
const emit = defineEmits<{ (e: "select", node: string): void }>();
const shown = computed(() => (props.limit ? props.rows.slice(0, props.limit) : props.rows));
function pct(r: NodeCoverage) { return r.examItems ? Math.round((100 * (r.solidItems ?? 0)) / r.examItems) : 0; }
</script>
<template>
  <ul class="grid gap-0.5">
    <li v-for="r in shown" :key="r.node">
      <component
        :is="selectable ? 'button' : 'div'"
        :type="selectable ? 'button' : undefined"
        class="grid w-full gap-2 rounded-card px-3 py-2.5 text-left transition-colors"
        :class="selectable ? 'hover:bg-surface-2 active:bg-surface-2' : ''"
        @click="selectable && emit('select', r.node)"
      >
        <div class="flex items-baseline justify-between gap-3">
          <span class="truncate text-[13.5px] font-medium">
            <span class="tabular mr-1.5 text-muted">{{ r.node }}</span>{{ r.label }}
          </span>
          <span class="tabular shrink-0 text-[12px] text-muted">
            <template v-if="r.solidItems != null"><strong class="font-semibold text-ink">{{ r.solidItems }}</strong>/{{ r.examItems }} solid</template>
            <template v-else>{{ Math.max(0, 3 - r.seen) }} more to tell</template>
          </span>
        </div>

        <div class="flex h-1.5 overflow-hidden rounded-pill bg-surface-3" aria-hidden="true">
          <span class="h-full rounded-pill bg-ok transition-[width] duration-500 ease-emphasized" :style="{ width: pct(r) + '%' }" />
        </div>

        <div class="flex justify-between text-[11px] text-muted">
          <span>{{ r.examItems }} on the exam</span>
          <span class="tabular">seen {{ r.seen }} of {{ r.bankItems }}</span>
        </div>
      </component>
    </li>
  </ul>
</template>
