/**
 * Free-tier accounting (20 questions, full explanations, one state, one short mock).
 *
 * This is the client's copy of the rule so the UI can be honest ("12 of 20 free questions left")
 * and offline. It is UX, not security: `issue-batch` enforces the same numbers server-side
 * (apps/api/supabase/functions/_shared/limits.ts) and refuses with 402/403 when exceeded.
 * Persisted in Dexie kv under `freeTier` so it survives reloads.
 */

export const FREE_TIER_ITEMS = 20;
export const FREE_TIER_MOCK_ITEMS = 20;
/** Must match FREE_TIER_MOCK_FORM in apps/api `_shared/limits.ts`. */
export const FREE_TIER_MOCK_FORM = "short";

export interface FreeTierState {
  /** The one jurisdiction the free tier is locked to once the first answer lands. */
  jurisdiction: string | null;
  /** Distinct item ids answered so far (order = first answered). */
  answeredIds: string[];
  /** The single short mock has been started. */
  mockUsed: boolean;
}

export function emptyFreeTier(): FreeTierState {
  return { jurisdiction: null, answeredIds: [], mockUsed: false };
}

/** Accept whatever is in kv (older shapes, garbage) and produce a valid state. */
export function normalizeFreeTier(v: unknown): FreeTierState {
  if (!v || typeof v !== "object") return emptyFreeTier();
  const r = v as Record<string, unknown>;
  const ids = Array.isArray(r.answeredIds) ? r.answeredIds.filter((x): x is string => typeof x === "string") : [];
  return {
    jurisdiction: typeof r.jurisdiction === "string" && r.jurisdiction ? r.jurisdiction : null,
    answeredIds: [...new Set(ids)],
    mockUsed: r.mockUsed === true,
  };
}

export function freeRemaining(s: FreeTierState): number {
  return Math.max(0, FREE_TIER_ITEMS - s.answeredIds.length);
}

export function freeExhausted(s: FreeTierState): boolean {
  return freeRemaining(s) === 0;
}

/** An item already answered stays answerable (its explanation is part of the free value). */
export function canAnswerFree(s: FreeTierState, itemId: string): boolean {
  return s.answeredIds.includes(itemId) || freeRemaining(s) > 0;
}

export function recordFreeAnswer(s: FreeTierState, itemId: string, jurisdiction: string): FreeTierState {
  if (s.answeredIds.includes(itemId)) return s;
  return { ...s, jurisdiction: s.jurisdiction ?? jurisdiction, answeredIds: [...s.answeredIds, itemId] };
}

/**
 * Keep already-answered ids (reviews are free) and at most `remaining` unseen ones, preserving the
 * scheduler's order so due items still come first.
 */
export function limitFreeCandidates(s: FreeTierState, candidates: string[]): string[] {
  let budget = freeRemaining(s);
  const seen = new Set(s.answeredIds);
  const out: string[] = [];
  for (const id of candidates) {
    if (seen.has(id)) { out.push(id); continue; }
    if (budget > 0) { out.push(id); budget--; }
  }
  return out;
}

/** Once a state is locked in, only that state is allowed. Complete bypasses this on the server. */
export function canSwitchJurisdiction(s: FreeTierState, to: string): boolean {
  return s.jurisdiction === null || s.jurisdiction === to;
}

/** The one free mock: a short form of FREE_TIER_MOCK_ITEMS questions inside the remaining budget. */
export function shortMockIds(s: FreeTierState, ids: string[]): string[] {
  return limitFreeCandidates(s, ids).slice(0, FREE_TIER_MOCK_ITEMS);
}
