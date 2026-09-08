/**
 * F20 — study plan back-planned from the exam date.
 * Goal by exam day: every blueprint node "solid" (≥ MIN_SEEN items seen, mastery ≥ target) and every
 * item in the pipeline out of red. We convert that into a daily answer target, front-loading unseen
 * items so reviews (yellow → green) have time to come due before the exam.
 */
import type { NodeCoverage } from "./coverage.js";
import type { Pipeline } from "./srs.js";
import { MIN_SEEN_FOR_CLAIM } from "./coverage.js";

export interface Plan {
  daysLeft: number | null;
  /** items still never seen across the banks */
  unseen: number;
  /** items in red or leech that need re-answering */
  redOrLeech: number;
  /** nodes with fewer than MIN_SEEN items seen */
  thinNodes: number;
  /** answers needed in total (unseen + reds×2 + reviews) */
  answersNeeded: number;
  /** answers per day to finish 3 days before the exam (buffer for final mocks) */
  dailyTarget: number | null;
  /** how many full-length mocks to fit in (5–10 recommended; SPEC F11) */
  mocksPlanned: number;
  status: "no-date" | "on-track" | "tight" | "behind" | "exam-passed";
  message: string;
}

export const REVIEW_BUFFER_DAYS = 3;
export const MASTERY_TARGET = 0.8;

export function buildPlan(opts: { examDate: string | null; pipelines: Pipeline[]; coverage: NodeCoverage[]; now?: number }): Plan {
  const now = opts.now ?? Date.now();
  const unseen = opts.pipelines.reduce((a, p) => a + p.unseen, 0);
  const redOrLeech = opts.pipelines.reduce((a, p) => a + p.red, 0);
  const yellow = opts.pipelines.reduce((a, p) => a + p.yellow, 0);
  const thinNodes = opts.coverage.filter((c) => c.seen < MIN_SEEN_FOR_CLAIM).length;
  // each unseen item ≈ 1 answer + ~1.3 reviews to reach green; reds ≈ 2 answers; yellows ≈ 1 review
  const answersNeeded = Math.round(unseen * 2.3 + redOrLeech * 2 + yellow);
  const mocksPlanned = 5;
  if (!opts.examDate) return { daysLeft: null, unseen, redOrLeech, thinNodes, answersNeeded, dailyTarget: null, mocksPlanned, status: "no-date", message: "Set your exam date to get a daily target." };
  const exam = Date.parse(opts.examDate + "T09:00:00");
  const daysLeft = Math.ceil((exam - now) / 86_400_000);
  if (daysLeft < 0) return { daysLeft, unseen, redOrLeech, thinNodes, answersNeeded, dailyTarget: null, mocksPlanned, status: "exam-passed", message: "Your exam date has passed. Update it if you are retaking." };
  const studyDays = Math.max(1, daysLeft - REVIEW_BUFFER_DAYS);
  const dailyTarget = Math.ceil(answersNeeded / studyDays);
  const mockMinutesPerDay = (mocksPlanned * 200) / Math.max(1, daysLeft); // ≈ 200 min per full-length mock
  const status: Plan["status"] = dailyTarget <= 40 ? "on-track" : dailyTarget <= 80 ? "tight" : "behind";
  const message = status === "on-track"
    ? `${dailyTarget} answers a day gets every question out of red with ${REVIEW_BUFFER_DAYS} days to spare for mocks (~${Math.round(mockMinutesPerDay)} min/day of mock time).`
    : status === "tight"
      ? `${dailyTarget} answers a day is doable but leaves little slack; prioritise unseen items in your weakest sections.`
      : `${dailyTarget} answers a day is more than most people sustain. Focus on the sections with the most exam items first; the coverage meter shows where.`;
  return { daysLeft, unseen, redOrLeech, thinNodes, answersNeeded, dailyTarget, mocksPlanned, status, message };
}
