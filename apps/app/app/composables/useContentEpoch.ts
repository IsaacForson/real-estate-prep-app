/**
 * Honours the admin console's "refetch content on all devices" button.
 *
 * Questions are cached in IndexedDB so the app works on a train, which means a corrected item can
 * keep being shown for as long as a device never happens to refetch it. `app_settings.content_sync`
 * carries an epoch an admin can bump; each install compares it once per sign-in and, when it has
 * moved, drops its cached items so the next session is served fresh from issue-batch.
 *
 * Only the item cache is cleared. Progress, sessions and settings are the learner's own data and
 * are never touched — this is a cache invalidation, not a reset.
 */
import { getDb } from "~~/lib/study/db";

const EPOCH_KV = "content.epoch";

export function useContentEpoch() {
  const supabase = useSupabase();

  async function check(): Promise<{ cleared: boolean; epoch: number | null }> {
    if (!import.meta.client || !supabase) return { cleared: false, epoch: null };
    try {
      const { data, error } = await supabase.from("v_app_runtime").select("content_epoch").maybeSingle();
      if (error || !data) return { cleared: false, epoch: null };
      const epoch = Number((data as { content_epoch: number }).content_epoch);
      if (!Number.isFinite(epoch)) return { cleared: false, epoch: null };

      const db = getDb();
      const seen = (await db.kv.get(EPOCH_KV))?.value as number | undefined;
      // first run just records where we are; there is nothing stale to clear yet
      if (seen === undefined) {
        await db.kv.put({ key: EPOCH_KV, value: epoch });
        return { cleared: false, epoch };
      }
      if (seen === epoch) return { cleared: false, epoch };

      await db.items.clear();
      await db.kv.put({ key: EPOCH_KV, value: epoch });
      return { cleared: true, epoch };
    } catch {
      // offline, or the view is not deployed yet: keep studying from cache
      return { cleared: false, epoch: null };
    }
  }

  return { check };
}
