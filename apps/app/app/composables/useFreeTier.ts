/**
 * Free-tier gate state (SPEC §6). Applies whenever Supabase is configured and the account is not
 * Complete — signed out (local-only) or signed in on the free tier. Never applies in static dev
 * mode. Persisted in Dexie kv (`freeTier`) so it survives reloads; the server enforces the same
 * limits in issue-batch, this copy is what the UI shows.
 */
import { getDb } from "~~/lib/study/db";
import {
  FREE_TIER_ITEMS, FREE_TIER_MOCK_ITEMS, FREE_TIER_MOCK_FORM,
  canSwitchJurisdiction, emptyFreeTier, freeExhausted, freeRemaining, limitFreeCandidates,
  normalizeFreeTier, recordFreeAnswer, shortMockIds, type FreeTierState,
} from "~~/lib/study/freeTier";

const KV_KEY = "freeTier";

export function useFreeTier() {
  const state = useState<FreeTierState>("freeTier", emptyFreeTier);
  const loaded = useState<boolean>("freeTier.loaded", () => false);
  /** Set when issue-batch says the server-side allowance is gone (may precede the local count). */
  const serverExhausted = useState<boolean>("freeTier.serverExhausted", () => false);
  const mode = useAppMode();
  const { isComplete } = useEntitlement();

  const applies = computed(() => mode.value !== "static" && !isComplete.value);
  const remaining = computed(() => freeRemaining(state.value));
  const exhausted = computed(() => applies.value && (freeExhausted(state.value) || serverExhausted.value));
  const mockUsed = computed(() => applies.value && state.value.mockUsed);

  async function load(): Promise<FreeTierState> {
    if (!loaded.value && import.meta.client) {
      const kv = await getDb().kv.get(KV_KEY);
      state.value = normalizeFreeTier(kv?.value);
      loaded.value = true;
    }
    return state.value;
  }
  async function save(next: FreeTierState) {
    state.value = next;
    await getDb().kv.put({ key: KV_KEY, value: { ...next, answeredIds: [...next.answeredIds] } });
  }

  async function recordAnswer(itemId: string, jurisdiction: string): Promise<void> {
    if (!applies.value) return;
    const cur = await load();
    const next = recordFreeAnswer(cur, itemId, jurisdiction);
    if (next !== cur) await save(next);
  }
  async function markMockUsed(): Promise<void> {
    if (!applies.value) return;
    const cur = await load();
    if (!cur.mockUsed) await save({ ...cur, mockUsed: true });
  }
  /** Server told us the allowance is used up (402 free_tier_exhausted). */
  function noteServerFreeTier(info: { remaining: number; total: number } | null) {
    serverExhausted.value = !!info && info.remaining <= 0;
  }

  /** Candidate ids a session may use right now. */
  function limit(ids: string[]): string[] { return applies.value ? limitFreeCandidates(state.value, ids) : ids; }
  /** The one short mock's ids (20 inside the remaining budget). */
  function shortMock(ids: string[]): string[] { return applies.value ? shortMockIds(state.value, ids) : ids; }
  function canSwitch(code: string): boolean { return !applies.value || canSwitchJurisdiction(state.value, code); }

  return {
    state, applies, remaining, exhausted, mockUsed, serverExhausted,
    total: FREE_TIER_ITEMS, mockSize: FREE_TIER_MOCK_ITEMS, mockForm: FREE_TIER_MOCK_FORM,
    load, recordAnswer, markMockUsed, noteServerFreeTier, limit, shortMock, canSwitch,
  };
}
