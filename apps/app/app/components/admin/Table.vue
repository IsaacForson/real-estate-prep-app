<script setup lang="ts" generic="T extends Record<string, any>">
/**
 * Keyboard-accessible data table. When `@select` is bound (or `rowTo` given), rows are focusable
 * and Enter/Space activates them. Cells render `row[column.key]` unless a `cell-<key>` slot exists.
 */
export interface AdminColumn { key: string; label: string; align?: "left" | "right" | "center"; width?: string; hideBelow?: "md" | "lg" }

const props = defineProps<{
  columns: AdminColumn[];
  rows: T[];
  rowKey: (row: T) => string | number;
  rowTo?: (row: T) => string | null | undefined;
  dense?: boolean;
  caption?: string;
}>();
const emit = defineEmits<{ select: [row: T] }>();

const interactive = computed(() => !!props.rowTo || !!getCurrentInstance()?.vnode.props?.onSelect);

async function activate(row: T) {
  const to = props.rowTo?.(row);
  if (to) await navigateTo(to);
  emit("select", row);
}
function onKey(e: KeyboardEvent, row: T) {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void activate(row); }
}
function cellText(row: T, key: string): string {
  const v = (row as Record<string, unknown>)[key];
  if (v == null || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
const hide = (c: AdminColumn) => (c.hideBelow === "md" ? "hidden md:table-cell" : c.hideBelow === "lg" ? "hidden lg:table-cell" : "");
const alignCls = (c: AdminColumn) => (c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left");
</script>
<template>
  <div class="overflow-x-auto rounded-card border border-line">
    <table class="w-full border-collapse text-sm" :class="dense ? 'text-[13px]' : ''">
      <caption v-if="caption" class="sr-only">{{ caption }}</caption>
      <thead class="bg-surface-2 text-xs uppercase tracking-wide text-muted">
        <tr>
          <th v-for="c in columns" :key="c.key" scope="col" class="whitespace-nowrap border-b border-line px-3 py-2 font-medium" :class="[alignCls(c), hide(c)]" :style="c.width ? { width: c.width } : undefined">{{ c.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="rowKey(row)"
          class="border-b border-line last:border-b-0 bg-surface"
          :class="interactive ? 'cursor-pointer hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent' : ''"
          :tabindex="interactive ? 0 : undefined"
          :role="interactive ? (rowTo ? 'link' : 'button') : undefined"
          @click="interactive && activate(row)"
          @keydown="interactive && onKey($event, row)"
        >
          <td v-for="c in columns" :key="c.key" class="px-3 align-top text-ink" :class="[alignCls(c), hide(c), dense ? 'py-1.5' : 'py-2.5']">
            <slot :name="`cell-${c.key}`" :row="row" :value="(row as any)[c.key]">{{ cellText(row, c.key) }}</slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
