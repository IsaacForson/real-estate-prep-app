import { describe, it, expect } from "vitest";
import { Item, type Blueprint } from "@rep/schema";
import { assembleForms, nationalSpecs, seedFor, toRows, type FormSpec } from "../src/forms.js";

const bp: Blueprint = {
  id: "national_pearsonvue", vendor: "pearsonvue", title: "t", source_document: null, source_url: null, source_version_or_date: null, accessed: "2026-09-08", copyright_note: "c", references: [], notes: null,
  exams: { salesperson: { scored_items: 10, pretest_items: null, domains: [
    { id: "I", label: "a", items: 6, subtopics: [] },
    { id: "II", label: "b", items: 4, subtopics: [] },
  ] } },
} as unknown as Blueprint;

function item(n: number, node: string, status: Item["status"] = "qa_approved") {
  return Item.parse({
    id: `NAT-PV-${node}-${String(n).padStart(4, "0")}`, jurisdiction: "NAT", bank: "national_pearsonvue", blueprint_node: node, vendor: "pearsonvue",
    cognitive_level: "knowledge", stem: `Unique stem number ${n} about national real estate practice for testing purposes only here.`,
    options: ["Option alpha", "Option bravo", "Option charlie", "Option delta"], key: "A",
    explanation: "Explanation text long enough to satisfy the schema minimum length requirement.",
    citation: { source: "REP Ref. § 1", url: null, quoted_text: "quoted text long enough for the schema minimum" },
    status, verified_on: "2026-09-01", reviewer: "r", qa_approved_on: "2026-09-02", version: 1,
  });
}

const spec = (form_id: string, count: number): FormSpec => ({ form_id, title: form_id, time_minutes: 30, pass_score: 0.7, sections: [{ portion: "national", bank: "national_pearsonvue", count, blueprint: bp, pass: "70%" }] });

describe("assembleForms", () => {
  it("deals non-overlapping forms from approved items only and skips a form the pool cannot fill", () => {
    const items = [
      ...Array.from({ length: 12 }, (_, i) => item(i + 1, "I")),
      ...Array.from({ length: 8 }, (_, i) => item(i + 101, "II")),
      item(999, "I", "verified"), // not approved: never used
    ];
    const r = assembleForms(items, [spec("short", 5), spec("full", 10), spec("full-2", 10)], 7);
    expect(r.forms.map((f) => f.form_id)).toEqual(["short", "full"]);
    expect(r.skipped).toEqual([{ form_id: "full-2", reason: "national_pearsonvue: need 10 unused items, have 5" }]);
    const all = r.forms.flatMap((f) => f.item_ids);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain("NAT-PV-I-0999");
    expect(r.forms[1]!.item_ids).toHaveLength(10);
    // proportions follow the blueprint: 6 of domain I, 4 of domain II
    expect(r.forms[1]!.item_ids.filter((id) => id.includes("-I-")).length).toBe(6);
    expect(r.forms[1]!.portions[0]).toMatchObject({ portion: "national", bank: "national_pearsonvue", pass_score: "70%" });
    expect(r.notes).toEqual([]);
  });
  it("tops up a thin node from the bank's other nodes rather than padding, and says so", () => {
    const items = [...Array.from({ length: 2 }, (_, i) => item(i + 1, "I")), ...Array.from({ length: 10 }, (_, i) => item(i + 101, "II"))];
    const r = assembleForms(items, [spec("full", 10)], 1);
    expect(r.forms[0]!.item_ids).toHaveLength(10);
    expect(r.notes[0]).toMatch(/full national_pearsonvue: 4 of 10 outside the blueprint proportions/);
  });
  it("is deterministic for a seed", () => {
    const items = Array.from({ length: 30 }, (_, i) => item(i + 1, i % 2 ? "I" : "II"));
    const a = assembleForms(items, [spec("short", 5), spec("full", 10)], seedFor("national_pearsonvue"));
    const b = assembleForms(items, [spec("short", 5), spec("full", 10)], seedFor("national_pearsonvue"));
    expect(a.forms.map((f) => f.item_ids)).toEqual(b.forms.map((f) => f.item_ids));
  });
});

describe("nationalSpecs / toRows", () => {
  it("builds short + as many full forms as the bank can carry", () => {
    expect(nationalSpecs("national_pearsonvue", [bp], 19).map((s) => s.form_id)).toEqual(["short"]);
    expect(nationalSpecs("national_pearsonvue", [bp], 30).map((s) => s.form_id)).toEqual(["short", "full"]);
    expect(nationalSpecs("national_pearsonvue", [bp], 40).map((s) => s.form_id)).toEqual(["short", "full", "full-2"]);
    expect(nationalSpecs("national_pearsonvue", [bp], 30)[1]).toMatchObject({ time_minutes: 150, pass_score: 0.7 });
  });
  it("keys rows deterministically per bank / jurisdiction / form", () => {
    const rows = toRows("national_pearsonvue", [{ form_id: "short", title: "S", time_limit_s: 1800, pass_score: 0.7, item_ids: ["a"], portions: [] }], "2026-09-09T00:00:00.000Z");
    expect(rows[0]).toMatchObject({ id: "national_pearsonvue:NAT:short", bank: "national_pearsonvue", jurisdiction: null, status: "active" });
    expect(toRows("FL", [{ form_id: "form-1", title: "F", time_limit_s: 60, pass_score: 0.75, item_ids: ["a"], portions: [] }])[0]).toMatchObject({ id: "state_FL:FL:form-1", bank: "state_FL", jurisdiction: "FL" });
  });
});
