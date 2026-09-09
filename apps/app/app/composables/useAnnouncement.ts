/**
 * The operator's one channel to every learner at once.
 *
 * It rides on `v_app_runtime`, the same row useContentEpoch already reads on sign-in, so a banner
 * costs no extra request. Dismissal is keyed to the announcement's `updated_at`: dismissing today's
 * notice must not also hide next month's, and re-publishing the same text is a deliberate act that
 * should reach people who dismissed the previous one.
 */
const DISMISS_KEY = "rep-announcement-dismissed";

export interface AppAnnouncement {
  message: string;
  tone: "info" | "warn" | "danger";
  /** identity of this particular publish, used as the dismissal key */
  at: string | null;
}

export function useAnnouncement() {
  const supabase = useSupabase();
  const current = useState<AppAnnouncement | null>("announcement", () => null);
  const dismissedAt = useState<string | null>("announcement.dismissed", () => null);

  const visible = computed(() => {
    const a = current.value;
    if (!a) return false;
    return (a.at ?? a.message) !== dismissedAt.value;
  });

  async function load(): Promise<void> {
    if (!import.meta.client || !supabase) return;
    try {
      dismissedAt.value = localStorage.getItem(DISMISS_KEY);
      const { data, error } = await supabase
        .from("v_app_runtime")
        .select("announcement, announcement_tone, announcement_at")
        .maybeSingle();
      if (error || !data) return;
      const row = data as { announcement: string | null; announcement_tone: string | null; announcement_at: string | null };
      if (!row.announcement) { current.value = null; return; }
      const tone = row.announcement_tone === "warn" || row.announcement_tone === "danger" ? row.announcement_tone : "info";
      current.value = { message: row.announcement, tone, at: row.announcement_at };
    } catch {
      // offline: no banner, and nothing to report. It is an announcement, not a blocker.
    }
  }

  function dismiss(): void {
    const a = current.value;
    if (!a) return;
    const id = a.at ?? a.message;
    dismissedAt.value = id;
    try { localStorage.setItem(DISMISS_KEY, id); } catch { /* private mode: it reappears next boot */ }
  }

  return { current, visible, load, dismiss };
}
