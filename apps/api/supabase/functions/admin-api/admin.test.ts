import { assert, assertEquals } from "@std/assert";
import { ADMIN_OPS, decideAdminAccess, isAdminOp } from "../_shared/admin.ts";
import { fillSeries, isKpiRange, seriesDays, shapeKpis } from "../_shared/kpis.ts";

Deno.test("admin guard: only a profile with is_admin === true passes", () => {
  assertEquals(decideAdminAccess({ authenticated: true, profile: { is_admin: true } }), { ok: true });
  assertEquals(decideAdminAccess({ authenticated: false, profile: { is_admin: true } }), {
    ok: false,
    status: 401,
    code: "missing_token",
  });
  assertEquals(decideAdminAccess({ authenticated: true, profile: null }), {
    ok: false,
    status: 403,
    code: "not_admin",
  });
  assertEquals(decideAdminAccess({ authenticated: true, profile: { is_admin: false } }), {
    ok: false,
    status: 403,
    code: "not_admin",
  });
  // truthy-but-not-true values never pass (a client cannot smuggle "true" or 1)
  assertEquals(decideAdminAccess({ authenticated: true, profile: { is_admin: "true" } }).ok, false);
  assertEquals(decideAdminAccess({ authenticated: true, profile: { is_admin: 1 } }).ok, false);
  assertEquals(decideAdminAccess({ authenticated: true, profile: {} }).ok, false);
});

Deno.test("admin ops list matches V2_PLAN §6.2", () => {
  const required = [
    "kpis",
    "users.search",
    "users.get",
    "users.disable",
    "users.enable",
    "users.sendCode",
    "users.removeDevice",
    "users.setAdmin",
    "users.impersonate",
    "users.stopImpersonation",
    "entitlements.grant",
    "entitlements.revoke",
    "entitlements.pause",
    "entitlements.resume",
    "coupons.create",
    "coupons.list",
    "coupons.disable",
    "tickets.list",
    "tickets.get",
    "tickets.reply",
    "tickets.close",
    "reviews.list",
    "reviews.setStatus",
    "events.list",
    "audit.list",
    "content.alerts",
    "content.resolveAlert",
    "content.versions",
    "content.resync",
    "content.summary",
    "devices.flagged",
    "devices.block",
    "settings.get",
    "settings.set",
    "refunds.list",
    "refunds.create",
    "refunds.decide",
    "refunds.markPaid",
    "refunds.eligibility",
  ];
  for (const op of required) assert(isAdminOp(op), `missing op ${op}`);
  assertEquals(ADMIN_OPS.length, required.length);
  assert(!isAdminOp("users.delete"));
  assert(!isAdminOp(42));
});

const today = new Date("2026-09-09T15:00:00Z");

Deno.test("kpi ranges and series length", () => {
  assert(isKpiRange("7d") && isKpiRange("30d") && isKpiRange("90d") && isKpiRange("all"));
  assert(!isKpiRange("1y"));
  assertEquals(seriesDays("7d"), 7);
  assertEquals(seriesDays("all"), 90);
  const s = fillSeries([], "7d", today);
  assertEquals(s.length, 8); // today + 7 days back, gap-free
  assertEquals(s[0]!.date, "2026-09-02");
  assertEquals(s[7]!.date, "2026-09-09");
});

Deno.test("fillSeries keeps known days, zero-fills gaps, drops junk", () => {
  const s = fillSeries(
    [
      { date: "2026-09-08", signups: "3", purchases: 1, answers: 120 },
      { date: "2026-09-09T00:00:00", signups: 1 },
      { date: "not-a-date", signups: 99 },
      { date: "2026-01-01", signups: 5 }, // outside the window
    ],
    "7d",
    today,
  );
  assertEquals(s.find((p) => p.date === "2026-09-08"), { date: "2026-09-08", signups: 3, purchases: 1, answers: 120 });
  assertEquals(s.find((p) => p.date === "2026-09-09"), { date: "2026-09-09", signups: 1, purchases: 0, answers: 0 });
  assertEquals(s.find((p) => p.date === "2026-09-05"), { date: "2026-09-05", signups: 0, purchases: 0, answers: 0 });
  assertEquals(s.length, 8);
});

Deno.test("shapeKpis makes the wire shape total and numeric", () => {
  const k = shapeKpis(
    {
      signups: "12",
      dau: 4,
      purchases: [{ store: "revenuecat_ios", count: 2, revenue_usd: "117.999" }, {
        store: "paddle",
        count: "1",
        revenue_usd: 59,
      }],
      conversion_pct: "8.3333",
      series: null,
      tickets_open: null,
    },
    "30d",
    today,
  );
  assertEquals(k.range, "30d");
  assertEquals(k.signups, 12);
  assertEquals(k.dau, 4);
  assertEquals(k.wau, 0);
  assertEquals(k.mau, 0);
  assertEquals(k.purchases, [{ store: "paddle", count: 1, revenue_usd: 59 }, {
    store: "revenuecat_ios",
    count: 2,
    revenue_usd: 118,
  }]);
  assertEquals(k.conversion_pct, 8.33);
  assertEquals(k.tickets_open, 0);
  assertEquals(k.reviews_pending, 0);
  assertEquals(k.series.length, 31);
  // garbage in → zeros out, never throws
  const empty = shapeKpis(undefined, "all", today);
  assertEquals(empty.purchases, []);
  assertEquals(empty.series.length, 91);
});
