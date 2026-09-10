/**
 * What the learner last chose to practise, so a new set stays in the same place.
 *
 * "Keep going" used to call startPractice() with no arguments, which defaults to both banks — so
 * finishing a set on one section dropped the learner into a mixed national set instead of more of
 * what they were working on. The hub records the scope when a set is started and the runner reuses
 * it, so Keep going means "another random set of this", whatever "this" was.
 */
export interface PracticeScope {
  kind: "practice" | "drill";
  banks?: string[];
  /** blueprint node when a single section was chosen, else null for the whole scope */
  node?: string | null;
  label?: string | null;
}

export function usePracticeScope() {
  const scope = useState<PracticeScope | null>("practice.scope", () => null);
  function set(s: PracticeScope) { scope.value = s; }
  function clear() { scope.value = null; }
  return { scope, set, clear };
}
