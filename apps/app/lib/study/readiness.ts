/**
 * F5 — readiness score with an honest methodology (see pages/methodology.vue, which must match this file).
 *
 * For each blueprint node we estimate the probability p_node that you answer an exam item from that
 * node correctly, from your recent answers on that node's items:
 *   - answers are weighted by recency (half-life 7 days) so old mistakes fade;
 *   - the estimate is a Beta posterior with a weak prior (α=β=1) shrunk toward your overall accuracy
 *     when a node has few answers, so one lucky guess can't make a node "solid";
 *   - unseen nodes take your overall accuracy, widened.
 * Expected score = Σ examItems_node × p_node.  Its variance = Σ examItems_node² × var(p_node) + binomial
 * item noise, from which we report a 90% interval and P(score ≥ pass threshold).
 * The score assumes ONE person is answering (SPEC §5.2).
 */
import type { Blueprint } from "@rep/schema";
import { nodeTargets } from "@rep/schema";
import type { Progress } from "./types.js";

export const HALF_LIFE_MS = 7 * 86_400_000;
const PRIOR = 1;         // α = β = 1
const SHRINK_K = 6;      // pseudo-answers pulling a node toward overall accuracy

export interface NodeEstimate { node: string; examItems: number; p: number; variance: number; nEffective: number }

export interface Readiness {
  portion: string;
  scoredItems: number;
  passThreshold: number | null;       // items needed, if the state publishes a threshold we can parse
  expectedScore: number;              // items
  expectedPct: number;                // 0..100
  low90: number;                      // items
  high90: number;
  passProbability: number | null;     // 0..1
  answersUsed: number;
  nodes: NodeEstimate[];
  confidence: "low" | "medium" | "high";
}

function weightedCounts(progress: Progress[], node: string, now: number) {
  let w = 0, wc = 0, n = 0;
  for (const p of progress) {
    if (!(p.node === node || p.node.startsWith(node + "."))) continue;
    for (const h of p.history) {
      const weight = Math.pow(0.5, (now - h.at) / HALF_LIFE_MS);
      w += weight; wc += weight * (h.correct ? 1 : 0); n++;
    }
  }
  return { w, wc, n };
}

export function readiness(bp: Blueprint, progress: Progress[], opts: { portion: string; scoredItems: number; passThreshold: number | null; exam?: "salesperson" | "broker"; now?: number }): Readiness {
  const now = opts.now ?? Date.now();
  const targets = nodeTargets(bp, opts.exam ?? "salesperson");
  // overall accuracy (recency-weighted) as the shrinkage target
  let W = 0, WC = 0, N = 0;
  for (const p of progress) for (const h of p.history) { const wt = Math.pow(0.5, (now - h.at) / HALF_LIFE_MS); W += wt; WC += wt * (h.correct ? 1 : 0); N++; }
  const overall = (WC + PRIOR) / (W + 2 * PRIOR);
  const scale = opts.scoredItems / Math.max(1, targets.reduce((a, t) => a + t.exam_items, 0));

  const nodes: NodeEstimate[] = targets.map((t) => {
    const { w, wc, n } = weightedCounts(progress, t.node, now);
    const alpha = wc + PRIOR + SHRINK_K * overall;
    const beta = (w - wc) + PRIOR + SHRINK_K * (1 - overall);
    const p = alpha / (alpha + beta);
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    return { node: t.node, examItems: t.exam_items * scale, p, variance, nEffective: n };
  });

  const expected = nodes.reduce((a, e) => a + e.examItems * e.p, 0);
  // variance of the total: uncertainty in p plus binomial noise of the exam draw itself
  const variance = nodes.reduce((a, e) => a + e.examItems ** 2 * e.variance + e.examItems * e.p * (1 - e.p), 0);
  const sd = Math.sqrt(variance);
  const low90 = Math.max(0, expected - 1.645 * sd);
  const high90 = Math.min(opts.scoredItems, expected + 1.645 * sd);
  const passProbability = opts.passThreshold == null ? null : 1 - normalCdf((opts.passThreshold - 0.5 - expected) / sd);
  const confidence: Readiness["confidence"] = N < 40 ? "low" : N < 150 ? "medium" : "high";
  return { portion: opts.portion, scoredItems: opts.scoredItems, passThreshold: opts.passThreshold, expectedScore: expected, expectedPct: (100 * expected) / opts.scoredItems, low90, high90, passProbability, answersUsed: N, nodes, confidence };
}

export function normalCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Parse a state record pass score like "75%", "56/80 (70%)", "scaled score 70", "30/40" into items needed, or null. */
export function passItemsFrom(passScore: string | null | undefined, scoredItems: number): number | null {
  if (!passScore) return null;
  const frac = passScore.match(/(\d+)\s*\/\s*(\d+)/);
  if (frac) return Math.round((Number(frac[1]) / Number(frac[2])) * scoredItems);
  const pct = passScore.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return Math.ceil((Number(pct[1]) / 100) * scoredItems);
  if (/scaled/i.test(passScore)) return null; // scaled scores are not item counts
  const bare = passScore.match(/^\s*(\d{2})\s*$/);
  if (bare && Number(bare[1]) <= 100) return Math.ceil((Number(bare[1]) / 100) * scoredItems);
  return null;
}
