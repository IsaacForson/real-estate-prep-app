import { describe, it, expect } from "vitest";
import { mk } from "./fixtures.js";
import {
  ruleNoAllNoneOfTheAbove, ruleOptionLengths, ruleAbsoluteQualifiers, ruleNegativeStemBolded,
  ruleLongestIsKeyShare, ruleKeyPositionDistribution, ruleNearDuplicateStems, ruleUniqueIds,
  ruleMathHasWork, lintItems, ruleNoMetaReference, ruleNumericallyDistinctOptions,
} from "../src/rules.js";

const rules = (fs: { rule: string }[]) => fs.map((f) => f.rule);

describe("per-item rules", () => {
  it("clean fixture passes", () => {
    expect(lintItems([mk()]).filter((f) => f.severity === "error")).toEqual([]);
  });
  it("rejects all/none of the above", () => {
    const it = mk({ options: ["Within one business day", "Within three business days", "Within five business days", "None of the above  "] });
    expect(rules(ruleNoAllNoneOfTheAbove(it))).toContain("no-all-none-of-the-above");
  });
  it("rejects unbalanced option lengths", () => {
    const it = mk({ options: ["Next business day", "Three business days from receipt of funds by the associate", "Five days", "At closing"] });
    expect(rules(ruleOptionLengths(it))).toContain("option-length-balance");
  });
  it("rejects absolute qualifier in a subset of options", () => {
    const it = mk({ options: ["Always by the next business day", "Within three business days", "Within five business days", "Before the closing date"] });
    expect(rules(ruleAbsoluteQualifiers(it))).toContain("absolute-qualifier");
  });
  it("allows absolute qualifiers present in all four options", () => {
    const it = mk({ options: ["Always the next business day", "Always within three days", "Always within five days", "Always before the closing"] });
    expect(ruleAbsoluteQualifiers(it)).toEqual([]);
  });
  it("requires bold negation in negative stems", () => {
    const bad = mk({ stem: "Which of the following is NOT a requirement for a Florida sales associate license application under chapter 475?" });
    const good = mk({ stem: "Which of the following is **NOT** a requirement for a Florida sales associate license application under chapter 475?" });
    expect(rules(ruleNegativeStemBolded(bad))).toContain("negative-stem-not-bolded");
    expect(ruleNegativeStemBolded(good)).toEqual([]);
  });
  it("flags numeric stems without worked solution", () => {
    const it = mk({ stem: "A property sells for $250,000 with a 6% commission split equally between two brokerages. What does the listing brokerage receive?" });
    expect(rules(ruleMathHasWork(it))).toContain("math-worked-solution");
    const ok = mk({ stem: it.stem, math: { worked_solution: "$250,000 × 0.06 = $15,000; ÷ 2 = $7,500.", formulas: ["commission"], onscreen_calculator_only: false } });
    expect(ruleMathHasWork(ok)).toEqual([]);
  });
});

describe("aggregate rules", () => {
  it("flags key-is-longest above 25% of a domain", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      mk({ n: i + 1, stem: `Scenario ${i}: a Florida sales associate receives earnest money and must act within the statutory deadline for deposits.`, options: ["By the next business day after receipt", "Three business days", "Five business days", "At closing"], key: "A" }),
    );
    expect(rules(ruleLongestIsKeyShare(items))).toContain("longest-option-is-key");
  });
  it("flags skewed key positions once n >= 20", () => {
    const items = Array.from({ length: 24 }, (_, i) => mk({ n: i + 1, stem: `Distinct scenario number ${i} about Florida escrow deposit timing and broker delivery obligations for associates.`, key: "B" }));
    const f = ruleKeyPositionDistribution(items);
    expect(rules(f)).toContain("key-position-distribution");
  });
  it("passes balanced key positions", () => {
    const keys = ["A", "B", "C", "D"] as const;
    const items = Array.from({ length: 24 }, (_, i) => mk({ n: i + 1, stem: `Distinct scenario number ${i} about Florida escrow deposit timing and broker delivery obligations for associates.`, key: keys[i % 4] }));
    expect(ruleKeyPositionDistribution(items)).toEqual([]);
  });
  it("detects near-duplicate stems", () => {
    const a = mk({ n: 1, stem: "A Florida sales associate receives an earnest money deposit on Tuesday. By when must it reach the broker?" });
    const b = mk({ n: 2, stem: "A Florida sales associate receives an earnest money deposit on Wednesday. By when must it reach the broker?" });
    expect(rules(ruleNearDuplicateStems([a, b]))).toContain("near-duplicate-stem");
  });
  it("detects duplicate ids", () => {
    expect(rules(ruleUniqueIds([mk({ n: 1 }), mk({ n: 1 })]))).toContain("unique-id");
  });
});


describe("v3 rules", () => {
  it("rejects meta references to the supplied text", () => {
    expect(rules(ruleNoMetaReference(mk({ stem: "According to the reference, how is the total commission calculated for a Florida sales associate?" })))).toContain("meta-reference-in-stem");
    expect(ruleNoMetaReference(mk())).toEqual([]);
  });
  it("rejects numerically identical options", () => {
    const it = mk({ options: ["$22,825", "$22,825.00", "$22,825.50", "$23,000"] });
    expect(rules(ruleNumericallyDistinctOptions(it))).toContain("options-numerically-equal");
    expect(ruleNumericallyDistinctOptions(mk({ options: ["$5,250", "$7,200", "$10,500", "$6,300"] }))).toEqual([]);
  });
});
