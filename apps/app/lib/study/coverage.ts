/**
 * F4 — blueprint coverage meter. Converts mastery into exam-day arithmetic:
 * "Agency and Disclosure: you're solid on 7 of the 10 items this section will contain."
 */
import type { Blueprint } from "@rep/schema";
import { nodeTargets } from "@rep/schema";
import type { Progress } from "./types.js";

export interface NodeCoverage {
  node: string;
  label: string;
  examItems: number;
  /** items in the bank tagged to this node (or its subtopics) */
  bankItems: number;
  seen: number;
  green: number;
  yellow: number;
  red: number;
  /** 0..1, null when too few items seen to say anything honest */
  mastery: number | null;
  /** exam items you're "solid" on = round(examItems × mastery) */
  solidItems: number | null;
}

export const MIN_SEEN_FOR_CLAIM = 3;

export function coverage(bp: Blueprint, bankItemNodes: Map<string, string>, progress: Map<string, Progress>, exam: "salesperson" | "broker" = "salesperson"): NodeCoverage[] {
  const targets = nodeTargets(bp, exam);
  return targets.map((t) => {
    let bankItems = 0, seen = 0, green = 0, yellow = 0, red = 0;
    for (const [itemId, node] of bankItemNodes) {
      if (!(node === t.node || node.startsWith(t.node + "."))) continue;
      bankItems++;
      const p = progress.get(itemId);
      if (!p || p.attempts === 0) continue;
      seen++;
      if (p.box === "green") green++; else if (p.box === "yellow") yellow++; else red++;
    }
    // mastery: greens count fully, yellows half, over items seen; unseen items count as unknown, not wrong
    const mastery = seen >= MIN_SEEN_FOR_CLAIM ? (green + 0.5 * yellow) / seen : null;
    return { node: t.node, label: t.label, examItems: t.exam_items, bankItems, seen, green, yellow, red, mastery, solidItems: mastery == null ? null : Math.round(t.exam_items * mastery) };
  });
}

export function totals(rows: NodeCoverage[]) {
  const examItems = rows.reduce((a, r) => a + r.examItems, 0);
  const claimed = rows.filter((r) => r.solidItems != null);
  const solid = claimed.reduce((a, r) => a + (r.solidItems ?? 0), 0);
  const claimedExamItems = claimed.reduce((a, r) => a + r.examItems, 0);
  return { examItems, solid, claimedExamItems, unclaimedExamItems: examItems - claimedExamItems };
}
