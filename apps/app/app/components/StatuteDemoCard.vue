<script setup lang="ts">
/**
 * Landing-page demo: a real-looking question with the citation revealed. Static copy, no data.
 * It reuses the production OptionButton and CitationBlock rather than a mock-up, so the landing
 * page can never drift from what the app actually looks like.
 */
const chosen = ref<string | null>(null);
const options = [
  { l: "A", t: "Within 10 business days of the buyer's request" },
  { l: "B", t: "Immediately upon receipt, unless the parties agree otherwise in writing" },
  { l: "C", t: "By the end of the third business day after receipt" },
  { l: "D", t: "At closing, along with the other trust account records" },
];
const key = "C";
function state(l: string) {
  if (!chosen.value) return "idle" as const;
  if (l === key) return "correct" as const;
  if (l === chosen.value) return "wrong" as const;
  return "dimmed" as const;
}
</script>
<template>
  <div class="overflow-hidden rounded-card border border-line bg-surface text-left shadow-card">
    <div class="flex items-center justify-between gap-2 border-b border-line bg-paper px-4 py-2 text-[11.5px] text-muted sm:px-5">
      <span>State · Florida · 3.2 Escrow</span>
      <Badge tone="outline">application</Badge>
    </div>

    <p class="px-4 pt-4 pb-4 text-[17px] font-medium leading-[1.45] tracking-[-0.011em] sm:px-5 sm:text-[18px]">
      A Florida broker receives an earnest money deposit on Monday. By when must it be placed in the
      escrow account?
    </p>

    <div class="grid gap-2 px-3 pb-4 sm:px-4">
      <OptionButton
        v-for="o in options"
        :key="o.l"
        :letter="o.l"
        :text="o.t"
        :state="state(o.l)"
        :disabled="!!chosen"
        @choose="chosen = o.l"
      />
    </div>

    <Transition enter-active-class="transition duration-200 ease-emphasized" enter-from-class="opacity-0 -translate-y-1">
      <div v-if="chosen" class="grid gap-3.5 border-t border-line bg-paper px-4 py-4 sm:px-5">
        <div class="flex items-center gap-2.5">
          <span
            class="grid size-6 shrink-0 place-items-center rounded-full text-white"
            :class="chosen === key ? 'bg-ok' : 'bg-danger'"
          ><Icon :name="chosen === key ? 'check' : 'x'" :size="14" :stroke-width="3" /></span>
          <strong class="text-[15px] tracking-[-0.011em]">{{ chosen === key ? 'Correct.' : `Not quite — the answer is ${key}.` }}</strong>
        </div>

        <p class="text-[14px] leading-relaxed text-ink-2">
          A sales associate must hand a deposit to the broker by the end of the next business day, and the
          broker must then place it in escrow no later than the end of the third business day after receipt.
          Saturdays, Sundays and legal holidays are not business days.
        </p>

        <CitationBlock
          source="Fla. Admin. Code R. 61J2-14.010(1)"
          quote="…shall immediately place the same in a bank, savings and loan association, trust company, credit union, or title company… no later than the end of the third business day following receipt of the item to be deposited."
          url="https://www.flrules.org/gateway/ruleno.asp?id=61J2-14.010"
        />
      </div>

      <p v-else class="px-4 pb-4 text-[12px] text-muted sm:px-5">Pick an answer to see what every explanation looks like.</p>
    </Transition>
  </div>
</template>
