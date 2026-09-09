/**
 * Published mock forms (`mock_forms`, migration 0021) as the client may see them: title, size,
 * time and pass score through the `v_mock_forms` view — never item ids. The Mocks screen lists the
 * vendor's national forms for every learner and a state form only when a row exists for that state.
 */
export interface PublishedForm {
  id: string;
  bank: string;
  jurisdiction: string | null;
  form_id: string;
  title: string;
  item_count: number;
  time_limit_s: number;
  pass_score: number;
  portions: Array<{ portion: "national" | "state"; bank: string; count: number; pass_score: string | null }>;
  published_at: string | null;
}

function parseRow(r: Record<string, unknown>): PublishedForm | null {
  if (typeof r.id !== "string" || typeof r.bank !== "string" || typeof r.form_id !== "string") return null;
  const portions = Array.isArray(r.portions)
    ? (r.portions as Array<Record<string, unknown>>).filter((p) => p && typeof p.bank === "string").map((p) => ({
        portion: p.portion === "state" ? "state" as const : "national" as const,
        bank: p.bank as string,
        count: typeof p.count === "number" ? p.count : Number(p.count) || 0,
        pass_score: typeof p.pass_score === "string" ? p.pass_score : null,
      }))
    : [];
  return {
    id: r.id,
    bank: r.bank,
    jurisdiction: typeof r.jurisdiction === "string" ? r.jurisdiction : null,
    form_id: r.form_id,
    title: typeof r.title === "string" ? r.title : r.form_id,
    item_count: typeof r.item_count === "number" ? r.item_count : Number(r.item_count) || 0,
    time_limit_s: typeof r.time_limit_s === "number" ? r.time_limit_s : Number(r.time_limit_s) || 0,
    pass_score: typeof r.pass_score === "number" ? r.pass_score : Number(r.pass_score) || 0,
    portions,
    published_at: typeof r.published_at === "string" ? r.published_at : null,
  };
}

export function useMockForms() {
  const supabase = useSupabase();
  const rows = useState<PublishedForm[]>("mockForms.rows", () => []);
  const loaded = useState<boolean>("mockForms.loaded", () => false);
  const loading = useState<boolean>("mockForms.loading", () => false);

  /** Forms for a learner: the state's own rows plus the vendor's national rows. Never throws. */
  async function load(jurisdiction: string | null, nationalBank: string | null): Promise<PublishedForm[]> {
    if (!supabase || !import.meta.client) { loaded.value = true; return rows.value; }
    loading.value = true;
    try {
      const clauses: string[] = [];
      if (jurisdiction) clauses.push(`jurisdiction.eq.${jurisdiction}`);
      if (nationalBank) clauses.push(`and(jurisdiction.is.null,bank.eq.${nationalBank})`);
      if (!clauses.length) { rows.value = []; return rows.value; }
      const { data, error } = await supabase.from("v_mock_forms").select("*").or(clauses.join(",")).order("published_at", { ascending: false });
      if (error || !data) return rows.value; // view not deployed yet, or offline: keep what we had
      rows.value = (data as Record<string, unknown>[]).map(parseRow).filter((x): x is PublishedForm => !!x);
      return rows.value;
    } catch {
      return rows.value;
    } finally {
      loaded.value = true;
      loading.value = false;
    }
  }

  const forState = (jur: string | null) => rows.value.filter((r) => !!jur && r.jurisdiction === jur);
  const national = (bank: string | null) => rows.value.filter((r) => r.jurisdiction === null && (!bank || r.bank === bank));

  return { rows, loaded, loading, load, forState, national };
}
