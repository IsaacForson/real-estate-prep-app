<script setup lang="ts">
/** Promise-based confirm rendered once by layouts/admin.vue; driven by useAdminConfirm(). */
const { pending, settle } = useAdminConfirm();
const dialog = ref<HTMLDialogElement | null>(null);
const reason = ref("");
const input = ref<HTMLInputElement | null>(null);

watch(pending, async (p) => {
  reason.value = "";
  await nextTick();
  if (p) { if (!dialog.value?.open) dialog.value?.showModal(); (input.value ?? dialog.value?.querySelector<HTMLElement>("[data-confirm]"))?.focus(); }
  else if (dialog.value?.open) dialog.value.close();
});
const canConfirm = computed(() => !(pending.value?.options.reason?.required && !reason.value.trim()));
function cancel() { settle({ ok: false, reason: "" }); }
function confirm() { if (canConfirm.value) settle({ ok: true, reason: reason.value.trim() }); }
</script>
<template>
  <dialog
    ref="dialog"
    class="m-auto w-[min(92vw,440px)] rounded-panel border border-line bg-surface p-0 text-ink shadow-float backdrop:bg-black/50 backdrop:backdrop-blur-[2px] open:anim-scale-in"
    @cancel.prevent="cancel"
    @click.self="cancel"
  >
    <form v-if="pending" method="dialog" class="p-5" @submit.prevent="confirm">
      <h2 class="m-0 text-base font-semibold">{{ pending.options.title }}</h2>
      <p v-if="pending.options.body" class="m-0 mt-1.5 text-sm leading-relaxed text-muted">{{ pending.options.body }}</p>
      <label v-if="pending.options.reason" class="mt-4 block text-sm">
        <span class="text-muted">{{ pending.options.reason.label }}<span v-if="pending.options.reason.required" class="text-danger"> *</span></span>
        <input
          ref="input"
          v-model="reason"
          :type="pending.options.reason.type ?? 'text'"
          :min="pending.options.reason.min"
          :step="pending.options.reason.step"
          class="mt-1.5 h-10 w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink placeholder:text-muted focus-visible:border-accent"
          :placeholder="pending.options.reason.placeholder"
        />
      </label>
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2"
          @click="cancel"
        >Cancel</button>
        <button
          type="submit"
          data-confirm
          :disabled="!canConfirm"
          class="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          :class="pending.options.danger ? 'bg-danger text-white' : 'bg-action text-action-ink'"
        >{{ pending.options.confirmLabel ?? "Confirm" }}</button>
      </div>
    </form>
  </dialog>
</template>
