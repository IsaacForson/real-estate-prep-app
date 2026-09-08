import { describe, it, expect } from "vitest";
import { Item, Blueprint, nodeTargets, StateRecord, JURISDICTION_CODES, nationalBankFor } from "../src/index.js";

const item = {
  id: "FL-475-0001", jurisdiction: "FL", bank: "state_FL", blueprint_node: "3.2", vendor: "pearsonvue",
  cognitive_level: "application",
  stem: "A Florida sales associate receives an earnest money deposit on Tuesday. By when must it be delivered to the broker?",
  options: ["By the end of the next business day", "Within three business days", "Within five business days", "Before the closing date"],
  key: "A",
  explanation: "Florida requires delivery to the broker no later than the end of the next business day following receipt of the funds.",
  citation: { source: "Fla. Admin. Code r. 61J2-14.009", url: null, quoted_text: "no later than the end of the next business day following receipt" },
  status: "draft", version: 1,
};

describe("Item", () => {
  it("parses a valid draft and applies defaults", () => {
    const p = Item.parse(item);
    expect(p.license_level).toBe("both");
    expect(p.terms).toEqual([]);
    expect(p.reviewer).toBeNull();
  });
  it("rejects id/jurisdiction/bank mismatches", () => {
    expect(Item.safeParse({ ...item, id: "TX-1101-0001" }).success).toBe(false);
    expect(Item.safeParse({ ...item, bank: "state_TX" }).success).toBe(false);
    expect(Item.safeParse({ ...item, bank: "national_psi" }).success).toBe(false);
  });
  it("rejects duplicate options and bad keys", () => {
    expect(Item.safeParse({ ...item, options: [...item.options.slice(0, 3), item.options[0]!] }).success).toBe(false);
    expect(Item.safeParse({ ...item, key: "E" }).success).toBe(false);
  });
  it("requires reviewer for qa_approved", () => {
    expect(Item.safeParse({ ...item, status: "qa_approved", verified_on: "2026-09-08" }).success).toBe(false);
    expect(Item.safeParse({ ...item, status: "qa_approved", verified_on: "2026-09-08", reviewer: "r1" }).success).toBe(true);
  });
});

describe("Blueprint", () => {
  const bp = Blueprint.parse({
    id: "national_pearsonvue", vendor: "pearsonvue", title: "t", source_document: null, source_url: null, source_version_or_date: null,
    accessed: "2026-09-08", copyright_note: "c",
    exams: { salesperson: { scored_items: 5, domains: [
      { id: "I", label: "Alpha", items: 3, cognitive: { knowledge: 2, application: 1 }, subtopics: [{ id: "I.A", label: "alpha one", items: 1 }, { id: "I.B", label: "alpha two", items: 2 }] },
      { id: "II", label: "Beta", items: 2, subtopics: [{ id: "II.A", label: "beta one", items: null }] },
    ] } },
  });
  it("targets per subtopic when counts sum, else per domain", () => {
    const t = nodeTargets(bp);
    expect(t.map((x) => x.node)).toEqual(["I.A", "I.B", "II"]);
    expect(t[0]!.target_bank_items).toBe(11);
    expect(t[0]!.cognitive_split).toEqual({ knowledge: 2, application: 1 });
    expect(t[2]!.target_bank_items).toBe(22);
  });
});

describe("StateRecord", () => {
  it("has 51 jurisdictions and maps vendors to national banks", () => {
    expect(JURISDICTION_CODES.length).toBe(51);
    expect(nationalBankFor("psi")).toBe("national_psi");
    expect(nationalBankFor("state")).toBeNull();
  });
  it("rejects unknown codes", () => {
    expect(StateRecord.safeParse({ code: "XX" }).success).toBe(false);
  });
});
