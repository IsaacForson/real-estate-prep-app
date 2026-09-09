/**
 * Shape the jsonb from fn_admin_kpis into the V2_PLAN §6.2 `kpis` contract. Pure. The sql does the
 * counting; this makes the wire shape total (every key present, numbers are numbers, series sorted
 * and gap-free for the requested range) so the console never special-cases missing data.
 */

export const KPI_RANGES = ["7d", "30d", "90d", "all"] as const;
export type KpiRange = (typeof KPI_RANGES)[number];

export function isKpiRange(x: unknown): x is KpiRange {
  return typeof x === "string" && (KPI_RANGES as readonly string[]).includes(x);
}

export interface KpiPurchases {
  store: string;
  count: number;
  revenue_usd: number;
}
export interface KpiPoint {
  date: string;
  signups: number;
  purchases: number;
  answers: number;
}
export interface Kpis {
  range: KpiRange;
  signups: number;
  dau: number;
  wau: number;
  mau: number;
  purchases: KpiPurchases[];
  refunds: number;
  active_complete: number;
  active_guarantee: number;
  conversion_pct: number;
  mocks_completed: number;
  answers: number;
  tickets_open: number;
  reviews_pending: number;
  series: KpiPoint[];
}

const num = (x: unknown): number => {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};
const obj = (
  x: unknown,
): Record<
  string,
  unknown
> => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

/** Days covered by the series for a range (all → trailing 90 days). */
export function seriesDays(range: KpiRange): number {
  return range === "7d" ? 7 : range === "30d" ? 30 : 90;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Build a gap-free, ascending daily series ending today. Unknown dates in `raw` are dropped. */
export function fillSeries(raw: unknown, range: KpiRange, today: Date = new Date()): KpiPoint[] {
  const byDate = new Map<string, KpiPoint>();
  if (Array.isArray(raw)) {
    for (const p of raw) {
      const o = obj(p);
      const date = typeof o.date === "string" ? o.date.slice(0, 10) : null;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      byDate.set(date, { date, signups: num(o.signups), purchases: num(o.purchases), answers: num(o.answers) });
    }
  }
  const days = seriesDays(range);
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const out: KpiPoint[] = [];
  for (let i = days; i >= 0; i--) {
    const d = isoDay(new Date(end.getTime() - i * 86_400_000));
    out.push(byDate.get(d) ?? { date: d, signups: 0, purchases: 0, answers: 0 });
  }
  return out;
}

export function shapeKpis(raw: unknown, range: KpiRange, today: Date = new Date()): Kpis {
  const r = obj(raw);
  const purchases: KpiPurchases[] = Array.isArray(r.purchases)
    ? r.purchases.map((p) => {
      const o = obj(p);
      return {
        store: typeof o.store === "string" ? o.store : "unknown",
        count: num(o.count),
        revenue_usd: Math.round(num(o.revenue_usd) * 100) / 100,
      };
    }).sort((a, b) => a.store.localeCompare(b.store))
    : [];
  return {
    range,
    signups: num(r.signups),
    dau: num(r.dau),
    wau: num(r.wau),
    mau: num(r.mau),
    purchases,
    refunds: num(r.refunds),
    active_complete: num(r.active_complete),
    active_guarantee: num(r.active_guarantee),
    conversion_pct: Math.round(num(r.conversion_pct) * 100) / 100,
    mocks_completed: num(r.mocks_completed),
    answers: num(r.answers),
    tickets_open: num(r.tickets_open),
    reviews_pending: num(r.reviews_pending),
    series: fillSeries(r.series, range, today),
  };
}
