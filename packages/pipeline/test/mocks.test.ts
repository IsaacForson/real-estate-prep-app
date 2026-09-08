import { describe, it, expect } from "vitest";
import { apportion, dealForms } from "../src/mocks.js";
import { Item } from "@rep/schema";

const targets = [
  { node: "1", label: "a", exam_items: 8, target_bank_items: 88 },
  { node: "2", label: "b", exam_items: 10, target_bank_items: 110 },
  { node: "3.1", label: "c", exam_items: 4, target_bank_items: 44 },
  { node: "3.2", label: "d", exam_items: 3, target_bank_items: 33 },
];

function item(n: number, node: string) {
  return Item.parse({
    id: `FL-475-${String(n).padStart(4, "0")}`, jurisdiction: "FL", bank: "state_FL", blueprint_node: node, vendor: "pearsonvue",
    cognitive_level: "knowledge", stem: `Unique stem number ${n} about Florida licensing law for testing purposes only here.`,
    options: ["Option alpha", "Option bravo", "Option charlie", "Option delta"], key: "A",
    explanation: "Explanation text long enough to satisfy the schema minimum length requirement.",
    citation: { source: "Fla. Stat. § 475.01", url: null, quoted_text: "quoted text long enough for the schema minimum" },
    status: "published", verified_on: "2026-09-01", reviewer: "r", qa_approved_on: "2026-09-02", version: 1,
  });
}

describe("apportion", () => {
  it("scales weights to the section size and sums exactly", () => {
    const a = apportion(targets, 40);
    expect(a.reduce((s, x) => s + x.count, 0)).toBe(40);
    expect(a.find((x) => x.node === "2")!.count).toBe(16);
  });
  it("handles a different total than the blueprint (PSI 100-item national)", () => {
    expect(apportion(targets, 100).reduce((s, x) => s + x.count, 0)).toBe(100);
  });
});

describe("dealForms", () => {
  it("deals non-overlapping forms and reports shortfalls", () => {
    const items = [
      ...Array.from({ length: 20 }, (_, i) => item(i + 1, "1")),
      ...Array.from({ length: 30 }, (_, i) => item(i + 101, "2")),
      ...Array.from({ length: 10 }, (_, i) => item(i + 201, "3.1")),
      ...Array.from({ length: 4 }, (_, i) => item(i + 301, "3.2")),
    ];
    const alloc = apportion(targets, 25); // 8,10,4,3
    const { forms, shortfalls } = dealForms(items, alloc, 2);
    const all = forms.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(shortfalls).toEqual([{ node: "3.2", need: 6, have: 4 }]);
    expect(forms[0]!.filter((id) => id.startsWith("FL-475-01")).length).toBe(10);
  });
  it("lets subtopic-tagged items satisfy a domain-level node", () => {
    const items = Array.from({ length: 6 }, (_, i) => item(i + 1, "1.4"));
    const { forms, shortfalls } = dealForms(items, [{ node: "1", count: 3 }], 2);
    expect(shortfalls).toEqual([]);
    expect(forms[0]!.length).toBe(3);
  });
});
