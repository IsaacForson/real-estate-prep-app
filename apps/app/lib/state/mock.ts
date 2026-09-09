/**
 * Client-side mock form assembly, used when `mock-start` is not available (static dev mode, or the
 * function is not deployed yet). Mirrors what the server builds: the state's exact national/state
 * split, proportional per blueprint node (lib/study/mockBuild.ts), timed proportionally.
 */
import type { Blueprint, Item, StateRecord } from "@rep/schema";
import { nationalBankFor } from "@rep/schema";
import { apportionIds } from "../study/mockBuild.js";
import type { StudySession } from "../study/types.js";

export interface MockPortionPlan { portion: "national" | "state"; bank: string; count: number; pass: string | null }

export interface MockFormSpec {
  natBank: string | null;
  stateBank: string;
  fullTotal: number;
  target: number;
  plan: MockPortionPlan[];
  timeLimitMs: number | null;
}

/** The exam's item split scaled to `maxItems` (free tier short form) or the full form. */
export function planMockForm(st: StateRecord, o: { licenseLevel: "salesperson" | "broker"; maxItems: number | null }): MockFormSpec | null {
  const exam = o.licenseLevel === "broker" && st.broker_exam ? st.broker_exam : st.salesperson_exam;
  if (!exam) return null;
  const natBank = nationalBankFor(st.vendor);
  const stateBank = `state_${st.code}`;
  const natCount = natBank && exam.national_items ? exam.national_items : 0;
  const stateCount = exam.state_items ?? (natBank ? 0 : exam.total_items ?? 0);
  const fullTotal = natCount + stateCount;
  if (!fullTotal) return null;
  const target = o.maxItems != null ? Math.min(o.maxItems, fullTotal) : fullTotal;
  const scale = target / fullTotal;
  const plan: MockPortionPlan[] = [];
  if (natBank && natCount) plan.push({ portion: "national", bank: natBank, count: Math.round(natCount * scale), pass: exam.pass_score_national ?? exam.pass_score_combined ?? null });
  if (stateCount) plan.push({ portion: "state", bank: stateBank, count: target - plan.reduce((a, p) => a + p.count, 0), pass: exam.pass_score_state ?? exam.pass_score_combined ?? null });
  const timeLimitMs = exam.time_minutes ? Math.round(exam.time_minutes * 60_000 * scale) : null;
  return { natBank, stateBank, fullTotal, target, plan, timeLimitMs };
}

export interface MockBuildDeps {
  blueprint(bank: string): Promise<Blueprint | null>;
  /** candidate ids per bank (already limited for the free tier by the caller) */
  ids(bank: string): Promise<string[]>;
  items(ids: string[]): Promise<Item[]>;
  seed?: number;
}

/** Pick items per portion. Returns the portions and the flattened id list (empty when the bank is too thin). */
export async function buildMockPortions(spec: MockFormSpec, deps: MockBuildDeps): Promise<{ portions: NonNullable<StudySession["portions"]>; itemIds: string[]; timeLimitMs: number | null }> {
  const portions: NonNullable<StudySession["portions"]> = [];
  for (const p of spec.plan) {
    if (p.count <= 0) continue;
    const bp = await deps.blueprint(p.bank);
    const ids = await deps.ids(p.bank);
    const picked = bp ? apportionIds(bp, ids, await deps.items(ids), p.count, deps.seed) : [];
    portions.push({ portion: p.portion, bank: p.bank, itemIds: picked, passScore: p.pass });
  }
  const itemIds = portions.flatMap((p) => p.itemIds);
  const timeLimitMs = spec.timeLimitMs != null && spec.target ? Math.round(spec.timeLimitMs * (itemIds.length / spec.target)) : null;
  return { portions, itemIds, timeLimitMs };
}

/** Score a finished session: overall and per portion (when the session carries portions). */
export function scoreSession(s: StudySession): { correct: number; total: number; pct: number; portions: Array<{ portion: string; correct: number; total: number; passScore: string | null }> } {
  const answers = s.answers;
  const total = s.itemIds.length;
  const correct = s.itemIds.filter((id) => answers[id]?.correct).length;
  const portions = (s.portions ?? []).map((p) => ({
    portion: p.portion,
    correct: p.itemIds.filter((id) => answers[id]?.correct).length,
    total: p.itemIds.length,
    passScore: p.passScore,
  }));
  return { correct, total, pct: total ? (100 * correct) / total : 0, portions };
}
