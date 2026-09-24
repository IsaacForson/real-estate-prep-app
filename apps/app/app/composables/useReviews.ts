/**
 * Reviews (V2 §1): 1–5 stars + text, PostgREST under RLS. `mine` is the signed-in user's review
 * (one per account; re-submitting updates it and returns it to `pending`), `approved` is the
 * public list for the landing page (anon-readable where status = approved).
 */
import { parseReview, type Review } from "~~/lib/state/contracts";

export type { Review };

function isDuplicateReview(err: { code?: string; message?: string }): boolean {
  return err.code === "23505" || (err.message ?? "").includes("reviews_user_uniq");
}

export function useReviews() {
  const supabase = useSupabase();
  const auth = useAuth();
  const events = useEvents();
  const { settings } = useStudyState();
  const mine = useState<Review | null>("reviews.mine", () => null);
  const approved = useState<Review[]>("reviews.approved", () => []);
  const approvedLoaded = useState<boolean>("reviews.approvedLoaded", () => false);
  const busy = useState<boolean>("reviews.busy", () => false);
  const error = useState<string | null>("reviews.error", () => null);

  async function load(): Promise<void> {
    const uid = auth.user.value?.id;
    if (!supabase || !uid) { mine.value = null; return; }
    const { data, error: err } = await supabase.from("reviews").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!err) mine.value = parseReview(data);
  }

  /** Public: approved reviews, newest first. Safe when signed out; empty on any error. */
  async function loadApproved(limit = 12): Promise<Review[]> {
    if (!supabase) return [];
    try {
      const { data, error: err } = await supabase.from("reviews").select("*").eq("status", "approved").order("created_at", { ascending: false }).limit(limit);
      if (!err && data) approved.value = (data as unknown[]).map(parseReview).filter((r): r is Review => !!r);
    } catch { /* table not deployed yet */ } finally { approvedLoaded.value = true; }
    return approved.value;
  }
  if (import.meta.client && !approvedLoaded.value) void loadApproved();

  async function submit(rating: number, body: string): Promise<{ ok: boolean; error?: string }> {
    const uid = auth.user.value?.id;
    if (!supabase || !uid) return { ok: false, error: "Sign in to leave a review." };
    const r = Math.min(5, Math.max(1, Math.round(rating)));
    const text = body.trim().slice(0, 2000);
    busy.value = true; error.value = null;
    try {
      // Account never loaded `mine` before, so a second submit always inserted and Postgres
      // answered with reviews_user_uniq. One review per account: load, then update.
      if (!mine.value) await load();
      const jurisdiction = settings.value.jurisdiction || null;
      const patch = { rating: r, body: text, status: "pending" as const, jurisdiction };
      const write = () => mine.value
        ? supabase.from("reviews").update(patch).eq("id", mine.value.id).eq("user_id", uid).select().maybeSingle()
        : supabase.from("reviews").insert({ user_id: uid, ...patch }).select().maybeSingle();
      let wasUpdate = !!mine.value;
      let { data, error: err } = await write();
      if (err && isDuplicateReview(err) && !wasUpdate) {
        await load();
        if (mine.value) {
          wasUpdate = true;
          ({ data, error: err } = await write());
        }
      }
      if (err) {
        const message = "Couldn't save your review. Try again.";
        error.value = message;
        return { ok: false, error: message };
      }
      mine.value = parseReview(data) ?? { id: mine.value?.id ?? "", user_id: uid, ...patch, created_at: new Date().toISOString(), author: null };
      events.track("review_submitted", { rating: r, length: text.length, update: wasUpdate });
      return { ok: true };
    } finally {
      busy.value = false;
    }
  }

  const averageRating = computed(() => approved.value.length ? approved.value.reduce((a, r) => a + r.rating, 0) / approved.value.length : null);

  return { mine, approved, averageRating, busy, error, load, loadApproved, submit };
}
