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
    class="m-auto w-[min(92vw,440px)] rounded-card border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40"
    @cancel.prevent="cancel"
    @click.self="cancel"
  >
    <form v-if="pending" method="dialog" class="p-5" @submit.prevent="confirm">
      <h2 class="m-0 text-base font-semibold">{{ pending.options.title }}</h2>
      <p v-if="pending.options.body" class="m-0 mt-2 text-sm text-muted">{{ pending.options.body }}</p>
      <label v-if="pending.options.reason" class="mt-3 block text-sm">
        <span class="text-muted">{{ pending.options.reason.label }}<span v-if="pending.options.reason.required" class="text-danger"> *</span></span>
        <input ref="input" v-model="reason" :type="pending.options.reason.type ?? 'text'" class="mt-1 w-full" :placeholder="pending.options.reason.placeholder" />
      </label>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" @click="cancel">Cancel</button>
        <button
          type="submit"
          data-confirm
          :disabled="!canConfirm"
          :class="pending.options.danger ? '!border-transparent !bg-danger !text-white' : 'primary'"
        >{{ pending.options.confirmLabel ?? "Confirm" }}</button>
      </div>
    </form>
  </dialog>
</template>
