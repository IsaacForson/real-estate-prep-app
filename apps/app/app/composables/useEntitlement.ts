/**
 * Entitlement (SPEC §6) and the learner's profile, read through PostgREST under RLS. The last
 * good answer is cached in Dexie kv per user so an offline launch still knows you're entitled.
 * The server re-checks entitlement on every issue-batch; this is for UX (gates, labels) only.
 */
import { getDb } from "~~/lib/study/db";

export interface EntitlementState { complete: boolean; passGuarantee: boolean; fetchedAt: number | null; userId: string | null }
export interface Profile { id: string; home_jurisdiction: string | null; exam_date: string | null; sharing_notice_ack: boolean; is_admin?: boolean }

const empty = (): EntitlementState => ({ complete: false, passGuarantee: false, fetchedAt: null, userId: null });
let cacheLoadedFor: string | null = null;

export function useEntitlement() {
  const supabase = useSupabase();
  const auth = useAuth();
  const ent = useState<EntitlementState>("entitlement", empty);
  const profile = useState<Profile | null>("profile", () => null);
  const loading = useState<boolean>("entitlement.loading", () => false);

  const forCurrentUser = computed(() => !!auth.user.value && ent.value.userId === auth.user.value.id);
  const isComplete = computed(() => forCurrentUser.value && ent.value.complete);
  const hasGuarantee = computed(() => forCurrentUser.value && ent.value.passGuarantee);
  const isFree = computed(() => !isComplete.value);
  /** Founder / internal QA accounts (profiles.is_admin): may run test purchases while already entitled. */
  const isAdmin = computed(() => !!profile.value?.is_admin);

  /** kv cache first (offline), then the network. Safe to call repeatedly. */
  async function load(): Promise<void> {
    const uid = auth.user.value?.id;
    if (!uid || !supabase) { ent.value = empty(); profile.value = null; return; }
    if (cacheLoadedFor !== uid) {
      const kv = await getDb().kv.get(`entitlement:${uid}`);
      if (kv?.value) ent.value = kv.value as EntitlementState;
      cacheLoadedFor = uid;
    }
    await refresh();
  }

  async function refresh(): Promise<void> {
    const uid = auth.user.value?.id;
    if (!uid || !supabase) return;
    loading.value = true;
    try {
      const { data, error } = await supabase.from("entitlements").select("product").is("revoked_at", null);
      if (!error && data) {
        const rows = data as Array<{ product: string }>;
        const next: EntitlementState = {
          complete: rows.some((r) => r.product === "complete"),
          passGuarantee: rows.some((r) => r.product === "pass_guarantee"),
          fetchedAt: Date.now(),
          userId: uid,
        };
        ent.value = next;
        await getDb().kv.put({ key: `entitlement:${uid}`, value: { ...next } });
      }
      const p = await supabase.from("profiles").select("id, home_jurisdiction, exam_date, sharing_notice_ack, is_admin").eq("id", uid).maybeSingle();
      if (!p.error && p.data) profile.value = p.data as Profile;
    } finally {
      loading.value = false;
    }
  }

  /** SPEC §5.2: records that the one-person notice was seen (server echoes it in issue-batch). */
  async function ackSharingNotice(): Promise<void> {
    const uid = auth.user.value?.id;
    if (!uid || !supabase) return;
    const { error } = await supabase.from("profiles").update({ sharing_notice_ack: true }).eq("id", uid);
    if (!error && profile.value) profile.value = { ...profile.value, sharing_notice_ack: true };
  }

  /**
   * The free tier is scoped to `profiles.home_jurisdiction` on the server. Set it on first choice;
   * a Complete account may move it freely.
   */
  async function setHomeJurisdiction(code: string): Promise<void> {
    const uid = auth.user.value?.id;
    if (!uid || !supabase || !code) return;
    if (profile.value?.home_jurisdiction === code) return;
    if (profile.value?.home_jurisdiction && !isComplete.value) return; // locked on the free tier
    const { error } = await supabase.from("profiles").update({ home_jurisdiction: code }).eq("id", uid);
    if (!error && profile.value) profile.value = { ...profile.value, home_jurisdiction: code };
  }

  async function setExamDate(date: string | null): Promise<void> {
    const uid = auth.user.value?.id;
    if (!uid || !supabase) return;
    const { error } = await supabase.from("profiles").update({ exam_date: date }).eq("id", uid);
    if (!error && profile.value) profile.value = { ...profile.value, exam_date: date };
  }

  return { entitlement: ent, profile, loading, isComplete, isFree, hasGuarantee, isAdmin, load, refresh, ackSharingNotice, setHomeJurisdiction, setExamDate };
}
