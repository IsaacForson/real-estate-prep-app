import { describe, it, expect } from "vitest";
import {
  FREE_TIER_ITEMS, FREE_TIER_MOCK_ITEMS, emptyFreeTier, normalizeFreeTier, freeRemaining, freeExhausted, canAnswerFree,
  recordFreeAnswer, limitFreeCandidates, canSwitchJurisdiction, shortMockIds, type FreeTierState,
} from "../lib/study/freeTier.js";
import { resolveMode } from "../lib/study/mode.js";

const ids = (n: number, prefix = "q") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
function answered(n: number, jurisdiction = "FL"): FreeTierState {
  return ids(n).reduce((s, id) => recordFreeAnswer(s, id, jurisdiction), emptyFreeTier());
}

describe("mode", () => {
  it("static without supabase, free when signed out, api when signed in", () => {
    expect(resolveMode({ supabaseConfigured: false, signedIn: false })).toBe("static");
    expect(resolveMode({ supabaseConfigured: false, signedIn: true })).toBe("static");
    expect(resolveMode({ supabaseConfigured: true, signedIn: false })).toBe("free");
    expect(resolveMode({ supabaseConfigured: true, signedIn: true })).toBe("api");
  });
});

describe("free tier accounting (SPEC §6)", () => {
  it("counts distinct answered questions against 40 and locks the jurisdiction on the first answer", () => {
    let s = emptyFreeTier();
    expect(freeRemaining(s)).toBe(FREE_TIER_ITEMS);
    s = recordFreeAnswer(s, "a", "FL");
    s = recordFreeAnswer(s, "a", "FL"); // re-answering the same item is free
    expect(s.answeredIds).toEqual(["a"]);
    expect(s.jurisdiction).toBe("FL");
    expect(freeRemaining(s)).toBe(FREE_TIER_ITEMS - 1);
    expect(recordFreeAnswer(s, "b", "TX").jurisdiction).toBe("FL"); // first lock wins
  });
  it("is exhausted at 40, but already-answered items stay answerable", () => {
    const s = answered(FREE_TIER_ITEMS);
    expect(freeExhausted(s)).toBe(true);
    expect(canAnswerFree(s, "q3")).toBe(true);
    expect(canAnswerFree(s, "new")).toBe(false);
    expect(canAnswerFree(answered(39), "new")).toBe(true);
  });
  it("limits a candidate list to answered ids plus the remaining budget, preserving order", () => {
    const s = answered(38);
    const cands = ["n1", "q5", "n2", "n3", "q0", "n4"];
    expect(limitFreeCandidates(s, cands)).toEqual(["n1", "q5", "n2", "q0"]);
    expect(limitFreeCandidates(answered(40), cands)).toEqual(["q5", "q0"]);
    expect(limitFreeCandidates(emptyFreeTier(), ids(45))).toHaveLength(40);
  });
  it("allows switching state only before the first answer or back to the locked one", () => {
    expect(canSwitchJurisdiction(emptyFreeTier(), "TX")).toBe(true);
    expect(canSwitchJurisdiction(answered(1), "FL")).toBe(true);
    expect(canSwitchJurisdiction(answered(1), "TX")).toBe(false);
  });
  it("builds the one short mock inside the remaining budget", () => {
    expect(shortMockIds(emptyFreeTier(), ids(100))).toHaveLength(FREE_TIER_MOCK_ITEMS);
    expect(shortMockIds(answered(35), ids(100, "m"))).toHaveLength(5);
    expect(shortMockIds(answered(40), ids(100, "m"))).toHaveLength(0);
  });
  it("normalizes whatever was persisted", () => {
    expect(normalizeFreeTier(undefined)).toEqual(emptyFreeTier());
    expect(normalizeFreeTier({ jurisdiction: "", answeredIds: ["a", 1, "a", null], mockUsed: "yes" })).toEqual({ jurisdiction: null, answeredIds: ["a"], mockUsed: false });
    expect(normalizeFreeTier({ jurisdiction: "FL", answeredIds: ["a"], mockUsed: true })).toEqual({ jurisdiction: "FL", answeredIds: ["a"], mockUsed: true });
  });
});
