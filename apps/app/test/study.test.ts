import { describe, it, expect } from "vitest";
import { newProgress, applyAnswer, scheduleSession, pipeline, leechDrill, DAY } from "../lib/study/srs.js";
import { coverage, totals } from "../lib/study/coverage.js";
import { readiness, passItemsFrom, normalCdf } from "../lib/study/readiness.js";
import type { Blueprint } from "@rep/schema";
import type { Progress } from "../lib/study/types.js";

const T0 = 1_800_000_000_000;

describe("srs", () => {
  it("moves red→yellow→green on correct, back to red on wrong, with growing intervals", () => {
    let p = newProgress("FL-475-0001", "state_FL", "1.1", T0);
    p = applyAnswer(p, true, T0);
    expect(p.box).toBe("yellow"); expect(p.dueAt).toBe(T0 + 2 * DAY);
    p = applyAnswer(p, true, T0 + 2 * DAY);
    expect(p.box).toBe("green"); expect(p.dueAt).toBe(T0 + 8 * DAY);
    p = applyAnswer(p, true, T0 + 8 * DAY);
    expect(p.box).toBe("green"); expect(p.dueAt - (T0 + 8 * DAY)).toBe(14 * DAY);
    p = applyAnswer(p, false, T0 + 9 * DAY);
    expect(p.box).toBe("red"); expect(p.dueAt).toBe(T0 + 9 * DAY); expect(p.streak).toBe(0);
  });
  it("flags leeches after 4 misses and releases after two consecutive corrects", () => {
    let p = newProgress("FL-475-0002", "state_FL", "1.1", T0);
    for (let i = 0; i < 4; i++) p = applyAnswer(p, false, T0 + i);
    expect(p.leech).toBe(true);
    p = applyAnswer(p, true, T0 + 10); expect(p.leech).toBe(true);
    p = applyAnswer(p, true, T0 + 11); expect(p.leech).toBe(false);
  });
  it("orders due reds, yellows, unseen, then not-due and leeches last (never an empty session)", () => {
    const m = new Map<string, Progress>();
    const red = applyAnswer(newProgress("A", "b", "1", T0), false, T0);
    const yellowDue = { ...applyAnswer(newProgress("B", "b", "1", T0), true, T0), dueAt: T0 };
    const yellowNotDue = applyAnswer(newProgress("C", "b", "1", T0), true, T0);
    let leech = newProgress("D", "b", "1", T0); for (let i = 0; i < 4; i++) leech = applyAnswer(leech, false, T0 + i);
    for (const p of [red, yellowDue, yellowNotDue, leech]) m.set(p.itemId, p);
    const ids = scheduleSession({ candidates: ["A", "B", "C", "D", "E", "F"], progress: m, size: 10, now: T0 + 1000, seed: 1 });
    // Priority is what the schedule controls: due red, then due yellow, then unseen.
    expect(ids.slice(0, 2)).toEqual(["A", "B"]);
    expect(ids.slice(2, 4).sort()).toEqual(["E", "F"]);
    // C is not due yet and D is a held leech. They come LAST rather than being dropped: excluding
    // them meant a learner who had seen everything got an empty session and "No questions
    // available right now" instead of practice.
    expect(ids.slice(4).sort()).toEqual(["C", "D"]);
    expect(leechDrill(m.values())).toEqual(["D"]);
    const pl = pipeline([...m.values()], 6, T0 + 1000);
    expect(pl).toEqual({ red: 2, yellow: 2, green: 0, unseen: 2, leeches: 1, dueNow: 3 });
  });
  it("still returns a session when everything has been seen and nothing is due", () => {
    const m = new Map<string, Progress>();
    for (const id of ["A", "B", "C"]) {
      // answered correctly, so scheduled well into the future
      m.set(id, applyAnswer(newProgress(id, "b", "1", T0), true, T0));
    }
    const ids = scheduleSession({ candidates: ["A", "B", "C"], progress: m, size: 10, now: T0 + 1000, seed: 7 });
    expect(ids.sort()).toEqual(["A", "B", "C"]);
  });
});

const bp: Blueprint = {
  id: "state_FL", vendor: "pearsonvue", title: "t", source_document: null, source_url: null, source_version_or_date: null, accessed: "2026-09-08", copyright_note: "c", references: [], notes: null,
  exams: { salesperson: { scored_items: 10, pretest_items: null, domains: [
    { id: "1", label: "Licensing", items: 6, subtopics: [{ id: "1.1", label: "Who needs a license", items: null, statute_refs: [] }] },
    { id: "2", label: "Escrow", items: 4, subtopics: [] },
  ] } },
} as unknown as Blueprint;

describe("coverage", () => {
  it("reports solid items only once enough items were seen", () => {
    const nodes = new Map([["i1", "1.1"], ["i2", "1.1"], ["i3", "1.1"], ["i4", "1"], ["i5", "2"], ["i6", "2"]]);
    const prog = new Map<string, Progress>();
    for (const [id, box] of [["i1", "green"], ["i2", "green"], ["i3", "yellow"], ["i4", "red"]] as const) {
      let p = newProgress(id, "state_FL", nodes.get(id)!, T0);
      p = applyAnswer(p, box !== "red", T0); if (box === "green") p = applyAnswer(p, true, T0 + 1);
      prog.set(id, p);
    }
    prog.set("i5", applyAnswer(newProgress("i5", "state_FL", "2", T0), true, T0));
    const rows = coverage(bp, nodes, prog);
    const lic = rows.find((r) => r.node === "1")!;
    expect(lic.bankItems).toBe(4); expect(lic.seen).toBe(4); expect(lic.mastery).toBeCloseTo(2.5 / 4);
    expect(lic.solidItems).toBe(4); // round(6 × 0.625)
    const esc = rows.find((r) => r.node === "2")!;
    expect(esc.mastery).toBeNull(); expect(esc.solidItems).toBeNull(); // only 1 seen
    expect(totals(rows)).toEqual({ examItems: 10, solid: 4, claimedExamItems: 6, unclaimedExamItems: 4 });
  });
});

describe("readiness", () => {
  it("is near the prior with no data and rises with correct answers", () => {
    const empty = readiness(bp, [], { portion: "state", scoredItems: 40, passThreshold: 30, now: T0 });
    expect(empty.expectedPct).toBeCloseTo(50, 0); expect(empty.confidence).toBe("low"); expect(empty.answersUsed).toBe(0);
    const prog: Progress[] = [];
    for (let i = 0; i < 30; i++) { let p = newProgress(`x${i}`, "state_FL", i % 2 ? "1.1" : "2", T0); p = applyAnswer(p, i % 10 !== 0, T0 + i); prog.push(p); }
    const r = readiness(bp, prog, { portion: "state", scoredItems: 40, passThreshold: 30, now: T0 + 100 });
    expect(r.expectedPct).toBeGreaterThan(75); expect(r.expectedPct).toBeLessThan(92);
    expect(r.passProbability!).toBeGreaterThan(0.7);
    expect(r.low90).toBeLessThan(r.expectedScore); expect(r.high90).toBeGreaterThan(r.expectedScore);
  });
  it("parses pass scores", () => {
    expect(passItemsFrom("75%", 40)).toBe(30);
    expect(passItemsFrom("56/80 (70%)", 80)).toBe(56);
    expect(passItemsFrom("30/40", 40)).toBe(30);
    expect(passItemsFrom("scaled score 70", 40)).toBeNull();
    expect(passItemsFrom(null, 40)).toBeNull();
    expect(normalCdf(0)).toBeCloseTo(0.5, 3); expect(normalCdf(1.645)).toBeCloseTo(0.95, 2);
  });
});

import { buildPlan } from "../lib/study/plan.js";
describe("plan", () => {
  const pipelines = [{ red: 10, yellow: 20, green: 30, unseen: 100, leeches: 2, dueNow: 12 }];
  it("needs a date", () => {
    expect(buildPlan({ examDate: null, pipelines, coverage: [] }).status).toBe("no-date");
  });
  it("back-plans a daily target with a 3-day buffer", () => {
    const now = Date.parse("2026-09-08T09:00:00");
    const p = buildPlan({ examDate: "2026-10-08", pipelines, coverage: [], now });
    expect(p.daysLeft).toBe(30);
    expect(p.answersNeeded).toBe(Math.round(100 * 2.3 + 10 * 2 + 20));
    expect(p.dailyTarget).toBe(Math.ceil(p.answersNeeded / 27));
    expect(p.status).toBe("on-track");
    const rushed = buildPlan({ examDate: "2026-09-12", pipelines, coverage: [], now });
    expect(rushed.status).toBe("behind");
    expect(buildPlan({ examDate: "2026-09-01", pipelines, coverage: [], now }).status).toBe("exam-passed");
  });
});
