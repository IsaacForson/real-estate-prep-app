import type { ItemInput } from "@rep/schema";
import { Item } from "@rep/schema";

export function mk(over: Partial<ItemInput> & { n?: number } = {}) {
  const n = over.n ?? 1;
  const base: ItemInput = {
    id: `FL-475-${String(n).padStart(4, "0")}`,
    jurisdiction: "FL",
    bank: "state_FL",
    blueprint_node: "3.2",
    vendor: "pearsonvue",
    cognitive_level: "application",
    stem: `A Florida sales associate receives an earnest money deposit on a Tuesday afternoon. By when must the deposit be delivered to the broker under scenario ${n}?`,
    options: [
      "By the end of the next business day",
      "Within three business days",
      "Within five business days",
      "Before the closing date",
    ],
    key: "A",
    explanation: "Florida requires a sales associate to deliver escrow funds to the broker no later than the end of the next business day following receipt.",
    citation: { source: "Fla. Admin. Code r. 61J2-14.009", url: null, quoted_text: "shall deliver the deposit to the broker or employer no later than the end of the next business day following receipt" },
    status: "draft",
    version: 1,
  };
  const { n: _n, ...rest } = over;
  return Item.parse({ ...base, ...rest });
}
