/**
 * F10 — red / yellow / green spaced repetition (a three-box Leitner system with leech detection).
 * Users were hand-rolling this with willpower; this is the box they were simulating.
 *
 *   new item → answered wrong → RED    (due again this session / today)
 *            → answered right → YELLOW (due in 2 days)
 *   YELLOW → right → GREEN (due in 6 days); wrong → RED
 *   GREEN  → right → stays GREEN, interval grows (14 d, then 30 d); wrong → RED
 *   4+ total misses → LEECH: routed to a focused drill and excluded from normal scheduling until drilled.
 */
import type { Progress, Box } from "./types.js";

export const DAY = 86_400_000;
export const LEECH_THRESHOLD = 4;
export const INTERVALS: Record<Box, number> = { red: 0, yellow: 2 * DAY, green: 6 * DAY };
const GREEN_GROWTH = [6 * DAY, 14 * DAY, 30 * DAY];
export const HISTORY_LIMIT = 30;

export function newProgress(itemId: string, bank: string, node: string, now = Date.now()): Progress {
  return { itemId, bank, node, box: "red", attempts: 0, correct: 0, streak: 0, misses: 0, leech: false, lastAnsweredAt: null, dueAt: now, history: [], clientUpdatedAt: now };
}

export function applyAnswer(p: Progress, correct: boolean, now = Date.now()): Progress {
  const attempts = p.attempts + 1;
  const correctCount = p.correct + (correct ? 1 : 0);
  const misses = p.misses + (correct ? 0 : 1);
  const streak = correct ? p.streak + 1 : 0;
  let box: Box;
  let interval: number;
  if (!correct) { box = "red"; interval = 0; }
  else if (p.box === "red") { box = "yellow"; interval = INTERVALS.yellow; }
  else if (p.box === "yellow") { box = "green"; interval = INTERVALS.green; }
  else { box = "green"; interval = GREEN_GROWTH[Math.min(GREEN_GROWTH.length - 1, Math.max(0, streak - 2))]!; }
  const leech = misses >= LEECH_THRESHOLD && !(correct && streak >= 2);
  const history = [...p.history, { at: now, correct }].slice(-HISTORY_LIMIT);
  return { ...p, attempts, correct: correctCount, misses, streak, box, leech, lastAnsweredAt: now, dueAt: now + interval, history, clientUpdatedAt: now };
}

export function isDue(p: Progress, now = Date.now()): boolean {
  return p.dueAt <= now;
}

export interface Pipeline { red: number; yellow: number; green: number; unseen: number; leeches: number; dueNow: number }

export function pipeline(all: Progress[], totalItems: number, now = Date.now()): Pipeline {
  const out: Pipeline = { red: 0, yellow: 0, green: 0, unseen: Math.max(0, totalItems - all.length), leeches: 0, dueNow: 0 };
  for (const p of all) {
    if (p.attempts === 0) { out.unseen++; continue; }
    out[p.box]++;
    if (p.leech) out.leeches++;
    if (isDue(p, now)) out.dueNow++;
  }
  return out;
}

/**
 * Pick the next session's items: due reds first, then due yellows, then due greens, then unseen,
 * excluding leeches (they get their own drill). Deterministic given `seed`.
 */
export function scheduleSession(opts: {
  candidates: string[];              // all item ids available in the chosen bank(s)
  progress: Map<string, Progress>;
  size: number;
  now?: number;
  seed?: number;
  includeLeeches?: boolean;
}): string[] {
  const now = opts.now ?? Date.now();
  let s = (opts.seed ?? now) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  const buckets: Record<"red" | "yellow" | "green" | "unseen", string[]> = { red: [], yellow: [], green: [], unseen: [] };
  for (const id of opts.candidates) {
    const p = opts.progress.get(id);
    if (!p || p.attempts === 0) { buckets.unseen.push(id); continue; }
    if (p.leech && !opts.includeLeeches) continue;
    if (!isDue(p, now)) continue;
    buckets[p.box].push(id);
  }
  const ordered = [...shuffle(buckets.red), ...shuffle(buckets.yellow), ...shuffle(buckets.green), ...shuffle(buckets.unseen)];
  return ordered.slice(0, opts.size);
}

export function leechDrill(progress: Iterable<Progress>, size = 20): string[] {
  return [...progress].filter((p) => p.leech).sort((a, b) => b.misses - a.misses).slice(0, size).map((p) => p.itemId);
}
