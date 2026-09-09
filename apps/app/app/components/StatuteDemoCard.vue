<script setup lang="ts">
/** Landing-page demo: a real-looking question with the citation revealed. Static copy, no data. */
const chosen = ref<string | null>(null);
const options = [
  { l: "A", t: "Within 10 business days of the buyer's request" },
  { l: "B", t: "Immediately upon receipt, unless the parties agree otherwise in writing" },
  { l: "C", t: "By the end of the third business day after receipt" },
  { l: "D", t: "At closing, along with the other trust account records" },
];
const key = "C";
function state(l: string) { if (!chosen.value) return "idle" as const; if (l === key) return "correct" as const; if (l === chosen.value) return "wrong" as const; return "dimmed" as const; }
</script>
<template>
  <div class="rounded-card bg-surface border border-line shadow-card overflow-hidden text-left">
    <div class="px-5 pt-4 flex items-center justify-between text-xs text-muted"><span>State · Florida · 3.2 Escrow</span><Badge tone="outline">application</Badge></div>
    <p class="px-5 pt-2 pb-4 text-[17px] font-medium leading-snug">A Florida broker receives an earnest money deposit on Monday. By when must it be placed in the escrow account?</p>
    <div class="px-4 pb-4 grid gap-2">
      <OptionButton v-for="o in options" :key="o.l" :letter="o.l" :text="o.t" :state="state(o.l)" :disabled="!!chosen" @choose="chosen = o.l" />
    </div>
    <Transition enter-active-class="transition duration-200" enter-from-class="opacity-0 translate-y-1">
      <div v-if="chosen" class="border-t border-line bg-paper px-5 py-4 grid gap-3">
        <strong class="text-[15px]">{{ chosen === key ? 'Correct.' : `Not quite — the answer is ${key}.` }}</strong>
        <p class="text-sm text-ink-2">A sales associate must hand a deposit to the broker by the end of the next business day, and the broker must then place it in escrow no later than the end of the third business day after receipt. Saturdays, Sundays and legal holidays are not business days.</p>
        <CitationBlock source="Fla. Admin. Code R. 61J2-14.010(1)" quote="…shall immediately place the same in a bank, savings and loan association, trust company, credit union, or title company… no later than the end of the third business day following receipt of the item to be deposited." url="https://www.flrules.org/gateway/ruleno.asp?id=61J2-14.010" compact />
      </div>
      <p v-else class="px-5 pb-4 text-xs text-muted">Pick an answer to see what every explanation looks like.</p>
    </Transition>
  </div>
</template>
