/**
 * F11 mock forms, server-built (V2_PLAN §3 mock-start / mock-finish). Pure: form specs and scoring.
 * Published forms live in `mock_forms` (0021, written by `pipeline forms-build`); mock-start uses a
 * row when one exists (see formPortions / pickFormRow below). Without a row a form is a size +
 * national/state split + time limit and items are drawn fresh per session from the candidates sql.
 */
import {
  FREE_TIER_MOCK_FORM,
  MOCK_FULL_MINUTES,
  MOCK_FULL_NATIONAL,
  MOCK_FULL_STATE,
  MOCK_PASS_SCORE,
  MOCK_SHORT_MINUTES,
  MOCK_SHORT_NATIONAL,
  MOCK_SHORT_STATE,
} from "./limits.ts";

export const FORM_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const NATIONAL_BANKS = ["national_pearsonvue", "national_psi"] as const;
export type NationalBank = (typeof NATIONAL_BANKS)[number];

export interface MockPortion {
  portion: "national" | "state";
  bank: string;
  count: number;
}

export interface MockFormSpec {
  form_id: string;
  jurisdiction: string;
  size: number;
  time_limit_ms: number;
  pass_score: number;
  portions: MockPortion[];
}

/** Spec for a form id in a jurisdiction. `short` is the free-tier form; anything else is full length. */
export function mockFormSpec(
  formId: string,
  jurisdiction: string,
  nationalBank: NationalBank = "national_pearsonvue",
): MockFormSpec {
  const short = formId === FREE_TIER_MOCK_FORM;
  const national = short ? MOCK_SHORT_NATIONAL : MOCK_FULL_NATIONAL;
  const state = short ? MOCK_SHORT_STATE : MOCK_FULL_STATE;
  const minutes = short ? MOCK_SHORT_MINUTES : MOCK_FULL_MINUTES;
  return {
    form_id: formId,
    jurisdiction,
    size: national + state,
    time_limit_ms: minutes * 60_000,
    pass_score: MOCK_PASS_SCORE,
    portions: [
      { portion: "national", bank: nationalBank, count: national },
      { portion: "state", bank: `state_${jurisdiction}`, count: state },
    ],
  };
}

export interface KeyedItem {
  public_id: string;
  key: "A" | "B" | "C" | "D";
  portion?: "national" | "state";
}
export interface MockAnswer {
  public_id: string;
  choice: "A" | "B" | "C" | "D" | null;
  ms?: number | null;
}

export interface ScoredItem {
  public_id: string;
  choice: "A" | "B" | "C" | "D" | null;
  key: "A" | "B" | "C" | "D";
  correct: boolean;
  ms: number | null;
}
export interface MockScore {
  total: number;
  answered: number;
  correct: number;
  /** correct / total (unanswered count as wrong), 4 dp */
  score: number;
  passed: boolean;
  portions: { portion: "national" | "state"; total: number; correct: number; score: number }[];
  items: ScoredItem[];
}

const CHOICES = new Set(["A", "B", "C", "D"]);

export function validateMockAnswer(x: unknown): MockAnswer | null {
  if (x === null || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.public_id !== "string" || r.public_id.length === 0 || r.public_id.length > 64) return null;
  const choice = r.choice === undefined || r.choice === null ? null : r.choice;
  if (choice !== null && (typeof choice !== "string" || !CHOICES.has(choice))) return null;
  const ms = r.ms === undefined || r.ms === null ? null : r.ms;
  if (ms !== null && (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0)) return null;
  return { public_id: r.public_id, choice: choice as MockAnswer["choice"], ms: ms as number | null };
}

/** Score a session: every item in the form counts; unanswered = wrong; unknown public ids ignored. */
export function scoreMock(items: KeyedItem[], answers: MockAnswer[], passScore = MOCK_PASS_SCORE): MockScore {
  const byId = new Map<string, MockAnswer>();
  for (const a of answers) if (!byId.has(a.public_id)) byId.set(a.public_id, a); // first answer wins
  const scored: ScoredItem[] = items.map((it) => {
    const a = byId.get(it.public_id);
    const choice = a?.choice ?? null;
    return {
      public_id: it.public_id,
      choice,
      key: it.key,
      correct: choice !== null && choice === it.key,
      ms: a?.ms ?? null,
    };
  });
  const total = scored.length;
  const correct = scored.filter((s) => s.correct).length;
  const answered = scored.filter((s) => s.choice !== null).length;
  const score = total === 0 ? 0 : Math.round((correct / total) * 10_000) / 10_000;
  const portions: MockScore["portions"] = [];
  for (const p of ["national", "state"] as const) {
    const sub = items.map((it, i) => ({ it, s: scored[i]! })).filter((x) => x.it.portion === p);
    if (sub.length === 0) continue;
    const c = sub.filter((x) => x.s.correct).length;
    portions.push({ portion: p, total: sub.length, correct: c, score: Math.round((c / sub.length) * 10_000) / 10_000 });
  }
  return { total, answered, correct, score, passed: total > 0 && score >= passScore, portions, items: scored };
}

/** Largest-remainder split of `total` across weights (mirrors packages/pipeline apportion). */
export function apportion(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total);
  const base = raw.map(Math.floor);
  let remaining = total - base.reduce((a, b) => a + b, 0);
  raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i).forEach(({ i }) => {
    if (remaining > 0) {
      base[i]!++;
      remaining--;
    }
  });
  return base;
}

// ---- published forms (mock_forms, migration 0021) ----------------------------------------------

/** One `mock_forms` row as the service role reads it. */
export interface MockFormRow {
  id: string;
  bank: string;
  jurisdiction: string | null;
  form_id: string;
  title: string;
  item_ids: string[];
  time_limit_s: number;
  pass_score: number | string;
  portions: unknown;
  status: string;
}

export interface FormPortion {
  portion: "national" | "state";
  bank: string;
  item_ids: string[];
  pass_score: string | null;
}

/**
 * Portions of a form row. Rows written by `pipeline forms-build` carry them; a row without them is
 * one portion whose kind follows the bank.
 */
export function formPortions(row: MockFormRow): FormPortion[] {
  const raw = Array.isArray(row.portions) ? row.portions as unknown[] : [];
  const out: FormPortion[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const ids = Array.isArray(r.item_ids) ? r.item_ids.filter((x): x is string => typeof x === "string") : [];
    if (typeof r.bank !== "string" || ids.length === 0) continue;
    out.push({
      portion: r.portion === "state" ? "state" : "national",
      bank: r.bank,
      item_ids: ids,
      pass_score: typeof r.pass_score === "string" ? r.pass_score : null,
    });
  }
  if (out.length) return out;
  const ids = row.item_ids.filter((x) => typeof x === "string");
  if (!ids.length) return [];
  return [{ portion: row.bank.startsWith("state_") ? "state" : "national", bank: row.bank, item_ids: ids, pass_score: null }];
}

/**
 * Which row serves `form_id` for a learner in `jurisdiction`: the state's own form when one was
 * published, otherwise the national form for the state's vendor. null → draw fresh (legacy path).
 */
export function pickFormRow(rows: MockFormRow[], jurisdiction: string, nationalBank: NationalBank): MockFormRow | null {
  const active = rows.filter((r) => r.status === "active" && r.item_ids.length > 0);
  return active.find((r) => r.jurisdiction === jurisdiction) ??
    active.find((r) => r.jurisdiction === null && r.bank === nationalBank) ??
    null;
}

/** Fit a form into `total` items (free tier): largest-remainder split across portions, order kept. */
export function truncatePortions(portions: FormPortion[], total: number): FormPortion[] {
  const size = portions.reduce((a, p) => a + p.item_ids.length, 0);
  if (total >= size) return portions;
  const counts = apportion(portions.map((p) => p.item_ids.length), Math.max(0, total));
  return portions.map((p, i) => ({ ...p, item_ids: p.item_ids.slice(0, counts[i] ?? 0) })).filter((p) => p.item_ids.length > 0);
}

export function formPassScore(row: MockFormRow): number {
  const n = typeof row.pass_score === "number" ? row.pass_score : Number.parseFloat(String(row.pass_score));
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : MOCK_PASS_SCORE;
}
