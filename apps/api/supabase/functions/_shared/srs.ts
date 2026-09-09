/**
 * Server-side mirror of apps/app/lib/study/srs.ts (F10 red / yellow / green Leitner boxes) so
 * mock-finish can update `progress` for the answered items without a round trip through the client.
 * Keep the two in sync; the client remains free to overwrite with a newer client_updated_at (lww).
 */
export type Box = "red" | "yellow" | "green";

export const DAY = 86_400_000;
export const LEECH_THRESHOLD = 4;
export const INTERVALS: Record<Box, number> = { red: 0, yellow: 2 * DAY, green: 6 * DAY };
const GREEN_GROWTH = [6 * DAY, 14 * DAY, 30 * DAY];
export const HISTORY_LIMIT = 30;

export interface SrsState {
  attempts: number;
  correct: number;
  streak: number;
  box: Box;
  due_at: string | null;
  last_answered_at: string | null;
  history: { at: number; correct: boolean }[];
}

export const EMPTY_SRS: SrsState = {
  attempts: 0,
  correct: 0,
  streak: 0,
  box: "red",
  due_at: null,
  last_answered_at: null,
  history: [],
};

export function applyAnswer(prev: SrsState | null, correct: boolean, nowMs: number = Date.now()): SrsState {
  const p = prev ?? EMPTY_SRS;
  const attempts = p.attempts + 1;
  const correctCount = p.correct + (correct ? 1 : 0);
  const streak = correct ? p.streak + 1 : 0;
  let box: Box;
  let interval: number;
  if (!correct) {
    box = "red";
    interval = 0;
  } else if (p.box === "red") {
    box = "yellow";
    interval = INTERVALS.yellow;
  } else if (p.box === "yellow") {
    box = "green";
    interval = INTERVALS.green;
  } else {
    box = "green";
    interval = GREEN_GROWTH[Math.min(GREEN_GROWTH.length - 1, Math.max(0, streak - 2))]!;
  }
  const history = [...p.history, { at: nowMs, correct }].slice(-HISTORY_LIMIT);
  return {
    attempts,
    correct: correctCount,
    streak,
    box,
    due_at: new Date(nowMs + interval).toISOString(),
    last_answered_at: new Date(nowMs).toISOString(),
    history,
  };
}

export function isLeech(s: SrsState): boolean {
  return s.attempts - s.correct >= LEECH_THRESHOLD;
}
