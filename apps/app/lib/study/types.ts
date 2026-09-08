import type { Item, OptionLetter } from "@rep/schema";

export type Box = "red" | "yellow" | "green";

/** Per-item learning state — the unit of persistence (SPEC F8: per-question, not per-session). */
export interface Progress {
  itemId: string;
  bank: string;
  node: string;
  box: Box;
  attempts: number;
  correct: number;
  /** consecutive correct answers */
  streak: number;
  /** total wrong answers; >= LEECH_THRESHOLD marks a leech */
  misses: number;
  leech: boolean;
  lastAnsweredAt: number | null;
  dueAt: number;
  /** last N outcomes, newest last, for readiness recency weighting */
  history: Array<{ at: number; correct: boolean }>;
  clientUpdatedAt: number;
}

export interface Answer {
  itemId: string;
  choice: OptionLetter;
  correct: boolean;
  at: number;
  /** ms spent on the question */
  elapsedMs: number;
}

export type SessionKind = "practice" | "mock" | "drill" | "review";

export interface StudySession {
  id: string;
  kind: SessionKind;
  jurisdiction: string;
  /** bank(s) this session draws from */
  banks: string[];
  itemIds: string[];
  position: number;
  answers: Record<string, Answer>;
  startedAt: number;
  endedAt: number | null;
  /** mocks only */
  timeLimitMs: number | null;
  mockFormId: string | null;
  /** per-portion split for mocks: which item ids belong to which portion */
  portions?: Array<{ portion: "national" | "state"; bank: string; itemIds: string[]; passScore: string | null }>;
  clientUpdatedAt: number;
}

export type StudyItem = Item;
