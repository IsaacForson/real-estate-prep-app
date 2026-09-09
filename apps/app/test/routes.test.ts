import { describe, it, expect } from "vitest";
import { authRedirect, isPublicPath, PUBLIC_ROUTES, WELCOME_PATH } from "../lib/state/routes.js";
import { maxUsage, parseHelpKb, parseMockStart, searchHelp } from "../lib/state/contracts.js";

describe("auth-first routing (V2 §6.1)", () => {
  it("public list matches exact paths and /** prefixes only", () => {
    for (const p of ["/", "/pricing", "/states", "/states/FL", "/states/FL/brief", "/methodology", "/legal/disclaimer", "/legal", "/welcome", "/signin", "/help", "/reviews", "/pricing/", "/pricing?x=1"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
    for (const p of ["/app", "/app/home", "/study", "/study/practice", "/account", "/admin", "/pricingx", "/statesman", "/help/anything"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
    expect(PUBLIC_ROUTES).toContain("/reviews");
  });
  it("signed out → /welcome for everything private; public routes pass", () => {
    const base = { signedIn: false, native: false, authConfigured: true };
    expect(authRedirect({ ...base, path: "/app/home" })).toBe(WELCOME_PATH);
    expect(authRedirect({ ...base, path: "/study/practice" })).toBe(WELCOME_PATH);
    expect(authRedirect({ ...base, path: "/pricing" })).toBeNull();
    expect(authRedirect({ ...base, path: "/" })).toBeNull();
    expect(authRedirect({ ...base, path: "/signin" })).toBeNull();
  });
  it("signed in passes everywhere; Capacitor sends the landing page to /welcome only when signed out", () => {
    expect(authRedirect({ path: "/app/home", signedIn: true, native: false, authConfigured: true })).toBeNull();
    expect(authRedirect({ path: "/", signedIn: false, native: true, authConfigured: true })).toBe(WELCOME_PATH);
    expect(authRedirect({ path: "/", signedIn: true, native: true, authConfigured: true })).toBeNull();
    expect(authRedirect({ path: "/pricing", signedIn: false, native: true, authConfigured: true })).toBeNull();
  });
  it("static dev mode (no Supabase) gates nothing", () => {
    expect(authRedirect({ path: "/app/home", signedIn: false, native: true, authConfigured: false })).toBeNull();
  });
});

describe("contracts: tolerant parsers", () => {
  it("help KB accepts an array or { articles } and searches by title/tags/body", () => {
    const kb = parseHelpKb({ articles: [
      { id: "refund", title: "Refunds and the pass guarantee", body: "Ask within 30 days …", tags: ["billing"] },
      { slug: "devices", question: "How many devices can I use?", answer: "Three at a time; remove one on the Account page." },
      { title: "no body" },
    ] });
    expect(kb.map((a) => a.id)).toEqual(["refund", "devices"]);
    expect(searchHelp(kb, "refund").map((a) => a.id)).toEqual(["refund"]);
    expect(searchHelp(kb, "how many devices")[0]!.id).toBe("devices");
    expect(searchHelp(kb, "billing")[0]!.id).toBe("refund");
    expect(searchHelp(kb, "the")).toEqual([]);
    expect(parseHelpKb(null)).toEqual([]);
  });
  it("mock-start accepts a flat or nested session and rejects an empty one", () => {
    expect(parseMockStart({ session: { id: "s1", item_ids: ["a", "b"], time_limit_minutes: 90, form_id: "FL-1" } })).toMatchObject({ session_id: "s1", item_ids: ["a", "b"], time_limit_s: 5400, form_id: "FL-1" });
    expect(parseMockStart({ session_id: "s2", public_ids: ["a"], time_limit_s: 60 })?.time_limit_s).toBe(60);
    expect(parseMockStart({ session_id: "s3", item_ids: [] })).toBeNull();
  });
  it("free tier usage takes the maximum of the user and device counters", () => {
    expect(maxUsage([
      { scope: "user", scope_id: "u", jurisdiction: "FL", questions_used: 12, mocks_used: 0 },
      { scope: "device", scope_id: "d", jurisdiction: null, questions_used: 40, mocks_used: 1 },
    ])).toEqual({ questionsUsed: 40, mocksUsed: 1, jurisdiction: "FL" });
    expect(maxUsage([])).toEqual({ questionsUsed: 0, mocksUsed: 0, jurisdiction: null });
  });
});
