/**
 * Free tier, server-fed (V2 §1, §6.1): 40 questions in one state + one short mock, counted per
 * account AND per device on the server (`free_tier_usage`), the device inheriting the maximum.
 * Nothing is counted locally any more — `remaining` comes from `issue-batch` responses and from
 * `free_tier_usage`; the optimistic decrements below only keep the label honest between syncs.
 * Applies whenever Supabase is configured and the account is not Complete; never in static dev mode.
 */
import { maxUsage, type FreeTierUsageRow } from "~~/lib/state/contracts";
import { FREE_TIER_ITEMS, FREE_TIER_MOCK_FORM, FREE_TIER_MOCK_ITEMS } from "~~/lib/study/freeTier";

export const FREE_TIER_MOCKS = 1;

interface FreeTierServerState {
  questionsUsed: number;
  mocksUsed: number;
  /** authoritative remaining count from the last issue-batch / mock-start response, if any */
  serverRemaining: number | null;
  jurisdiction: string | null;
  loadedAt: number | null;
}

export function useFreeTier() {
  const supabase = useSupabase();
  const auth = useAuth();
  const mode = useAppMode();
  const { isComplete, profile } = useEntitlement();
  const dev = useDevice();
  const srv = useState<FreeTierServerState>("freeTier.server", () => ({ questionsUsed: 0, mocksUsed: 0, serverRemaining: null, jurisdiction: null, loadedAt: null }));

  const applies = computed(() => mode.value !== "static" && !isComplete.value);
  const remaining = computed(() => {
    if (!applies.value) return Number.POSITIVE_INFINITY;
    const fromUsage = Math.max(0, FREE_TIER_ITEMS - srv.value.questionsUsed);
    return srv.value.serverRemaining == null ? fromUsage : Math.min(fromUsage, srv.value.serverRemaining);
  });
  const mocksRemaining = computed(() => (applies.value ? Math.max(0, FREE_TIER_MOCKS - srv.value.mocksUsed) : Number.POSITIVE_INFINITY));
  const jurisdiction = computed(() => profile.value?.home_jurisdiction ?? srv.value.jurisdiction);
  const exhausted = computed(() => applies.value && remaining.value <= 0);
  const mockUsed = computed(() => applies.value && mocksRemaining.value <= 0);
  /** legacy: issue-batch said the allowance is gone */
  const serverExhausted = computed(() => applies.value && srv.value.serverRemaining != null && srv.value.serverRemaining <= 0);

  /** Read `free_tier_usage` for this account and this device; max of both (V2 §1). Never throws. */
  async function load(): Promise<void> {
    const uid = auth.user.value?.id;
    if (!supabase || !uid || !applies.value) return;
    try {
      const deviceHash = dev.hash.value;
      const filter = deviceHash
        ? `and(scope.eq.user,scope_id.eq.${uid}),and(scope.eq.device,scope_id.eq.${deviceHash})`
        : `and(scope.eq.user,scope_id.eq.${uid})`;
      const { data, error } = await supabase.from("free_tier_usage").select("scope, scope_id, jurisdiction, questions_used, mocks_used, updated_at").or(filter);
      if (error || !data) return; // table not deployed yet, or RLS hides the device row: keep what issue-batch told us
      const m = maxUsage(data as FreeTierUsageRow[]);
      srv.value = { ...srv.value, questionsUsed: m.questionsUsed, mocksUsed: m.mocksUsed, jurisdiction: m.jurisdiction ?? srv.value.jurisdiction, loadedAt: Date.now() };
    } catch { /* offline: keep the last known numbers */ }
  }

  /** issue-batch / mock-start echoed the server's remaining allowance. */
  function noteServerFreeTier(info: { remaining: number; total: number; mocks_remaining?: number } | null) {
    if (!info) { srv.value = { ...srv.value, serverRemaining: null }; return; }
    const next: FreeTierServerState = { ...srv.value, serverRemaining: Math.max(0, info.remaining), questionsUsed: Math.max(srv.value.questionsUsed, (info.total || FREE_TIER_ITEMS) - info.remaining) };
    if (typeof info.mocks_remaining === "number") next.mocksUsed = Math.max(next.mocksUsed, FREE_TIER_MOCKS - info.mocks_remaining);
    srv.value = next;
  }

  /** Optimistic: an unseen item was just answered (the server recounts on the next issue-batch). */
  async function recordAnswer(_itemId: string, jur: string, wasUnseen = true): Promise<void> {
    if (!applies.value || !wasUnseen) return;
    srv.value = {
      ...srv.value,
      questionsUsed: srv.value.questionsUsed + 1,
      serverRemaining: srv.value.serverRemaining == null ? null : Math.max(0, srv.value.serverRemaining - 1),
      jurisdiction: srv.value.jurisdiction ?? jur,
    };
  }
  async function markMockUsed(): Promise<void> {
    if (!applies.value) return;
    srv.value = { ...srv.value, mocksUsed: Math.max(srv.value.mocksUsed, 1) };
  }

  /** Candidate ids a session may use now: already-seen items are free, unseen ones spend the budget. */
  function limit(ids: string[], isSeen: (id: string) => boolean = () => false): string[] {
    if (!applies.value) return ids;
    let budget = Math.max(0, remaining.value);
    const out: string[] = [];
    for (const id of ids) {
      if (isSeen(id)) { out.push(id); continue; }
      if (budget > 0) { out.push(id); budget--; }
    }
    return out;
  }
  /** The one short mock's ids (20 inside the remaining budget). */
  function shortMock(ids: string[]): string[] { return applies.value ? limit(ids).slice(0, FREE_TIER_MOCK_ITEMS) : ids; }
  /** Switching state is free until the first answer; afterwards only the locked (home) state. */
  function canSwitch(code: string): boolean {
    if (!applies.value) return true;
    const locked = jurisdiction.value;
    return !locked || locked === code || srv.value.questionsUsed === 0;
  }

  /** legacy shape for pages not yet rewritten */
  const state = computed(() => ({ jurisdiction: jurisdiction.value, answeredIds: [] as string[], mockUsed: mockUsed.value, questionsUsed: srv.value.questionsUsed }));

  return {
    remaining, mocksRemaining, jurisdiction, exhausted, load,
    applies, mockUsed, serverExhausted, state,
    total: FREE_TIER_ITEMS, mockSize: FREE_TIER_MOCK_ITEMS, mockForm: FREE_TIER_MOCK_FORM, mocksTotal: FREE_TIER_MOCKS,
    recordAnswer, markMockUsed, noteServerFreeTier, limit, shortMock, canSwitch,
  };
}
