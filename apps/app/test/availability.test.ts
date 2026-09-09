import { describe, it, expect } from "vitest";
import { ApiItemSource, fetchBatchItems, type BankAvailability, type IssueBatchResponse } from "../lib/study/itemSource.js";
import { scheduleSession } from "../lib/study/srs.js";
import { parseMockStart } from "../lib/state/contracts.js";
import type { StudyDb } from "../lib/study/db.js";
import type { Progress } from "../lib/study/types.js";

const rawItem = (id: string, bank: string, jurisdiction: string) => ({
  id, jurisdiction, bank, blueprint_node: "IV.B", vendor: "pearsonvue", cognitive_level: "knowledge",
  stem: "A broker receives an earnest money deposit on Friday. By when must it be deposited under the reference rule?",
  options: ["Next business day", "Three business days", "Ten days", "At closing"], key: "A",
  explanation: "The reference note says the deposit must be placed in the trust account no later than the end of the next business day following receipt.",
  citation: { source: "REP Ref. Brokerage Practice § 3.2", url: null, quoted_text: "no later than the end of the next business day following receipt of the funds" },
});

/** The four Dexie calls ApiItemSource makes, over plain maps. */
function fakeDb() {
  const items = new Map<string, { id: string; bank: string; node: string; item: unknown }>();
  const progress: Progress[] = [];
  const db = {
    items: {
      where: () => ({ equals: (bank: string) => ({ primaryKeys: async () => [...items.values()].filter((i) => i.bank === bank).map((i) => i.id) }) }),
      bulkGet: async (ids: string[]) => ids.map((id) => items.get(id)),
      bulkPut: async (rows: Array<{ id: string; bank: string; node: string; item: unknown }>) => { for (const r of rows) items.set(r.id, r); },
    },
    progress: { where: () => ({ equals: (bank: string) => ({ toArray: async () => progress.filter((p) => p.bank === bank) }) }) },
  } as unknown as StudyDb;
  return { db, items };
}

/** issue-batch as deployed: the state bank is empty (200, availability 0), the national bank serves real items. */
function fakeServer() {
  const calls: Array<{ fn: string; body: Record<string, unknown> }> = [];
  const nationalIds = ["pubA", "pubB", "pubC"];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/issue-batch")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ fn: "issue-batch", body });
      const now = new Date().toISOString();
      if (body.bank === "state_FL") {
        const res: IssueBatchResponse = {
          batch_id: null, kind: "practice", bank: "state_FL", jurisdiction: "FL", form_id: null, public_ids: [], issued_at: now, expires_at: now,
          signature: null, content_url: null, counts: { due: 0, new: 0 }, sharing_notice_ack: true,
          availability: { bank: "state_FL", items_available: 0, fallback_bank: "national_pearsonvue" },
        };
        return new Response(JSON.stringify(res));
      }
      const res: IssueBatchResponse = {
        batch_id: "b1", kind: "practice", bank: "national_pearsonvue", jurisdiction: "FL", form_id: null, public_ids: nationalIds, issued_at: now,
        expires_at: new Date(Date.now() + 3600_000).toISOString(), signature: "sig", content_url: "https://signed/b1.json", counts: { due: 0, new: 3 },
        free_tier: { remaining: 17, total: 20 }, sharing_notice_ack: true,
        availability: { bank: "national_pearsonvue", items_available: 118, fallback_bank: null },
      };
      return new Response(JSON.stringify(res));
    }
    if (url === "https://signed/b1.json") {
      return new Response(JSON.stringify({ items: nationalIds.map((id) => rawItem(id, "national_pearsonvue", "NAT")) }));
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("state bank empty → national-only session", () => {
  it("treats the honest empty batch as no items (not an error) and reports availability", async () => {
    const { db } = fakeDb();
    const { fetchImpl, calls } = fakeServer();
    const seen: BankAvailability[] = [];
    const freeTier: unknown[] = [];
    const errors: unknown[] = [];
    const src = new ApiItemSource({
      base: "https://x/functions/v1",
      headers: async () => ({ authorization: "Bearer t", "x-device-id": "d", "x-session-id": "s" }),
      jurisdiction: () => "FL",
      nationalBank: () => "national_pearsonvue",
      db,
      onSessionRevoked: () => { throw new Error("must not revoke"); },
      onAvailability: (a) => seen.push(a),
      onFreeTier: (f) => freeTier.push(f),
      onError: (e) => errors.push(e),
      fetchImpl,
    });

    const stateIds = await src.ids("state_FL");
    const nationalIds = await src.ids("national_pearsonvue");
    expect(stateIds).toEqual([]);
    expect(nationalIds).toEqual(["pubA", "pubB", "pubC"]);
    expect(errors).toEqual([]);
    expect(seen).toEqual([
      { bank: "state_FL", items_available: 0, fallback_bank: "national_pearsonvue" },
      { bank: "national_pearsonvue", items_available: 118, fallback_bank: null },
    ]);
    // the empty response carries no free_tier block; the national one does
    expect(freeTier).toEqual([{ remaining: 17, total: 20 }]);
    // the request names the vendor's national bank so the server can echo it as the fallback
    expect(calls[0]!.body).toMatchObject({ bank: "state_FL", jurisdiction: "FL", national_bank: "national_pearsonvue" });

    // what useStudy.startSession does with both banks: candidates = state ∪ national = national only
    const candidates = [...stateIds, ...nationalIds];
    const session = scheduleSession({ candidates, progress: new Map(), size: 20, seed: 1 });
    expect(session.sort()).toEqual(["pubA", "pubB", "pubC"]);
    const cached = await src.get(session);
    expect(cached.every((i) => i.bank === "national_pearsonvue")).toBe(true);

    // the empty bank is not asked again immediately (no hammering while it fills)
    await src.ids("state_FL");
    expect(calls.filter((c) => c.body.bank === "state_FL")).toHaveLength(1);
  });

  it("fetchBatchItems returns [] for an empty batch instead of fetching a null url", async () => {
    const now = new Date().toISOString();
    const res: IssueBatchResponse = {
      batch_id: null, kind: "practice", bank: "state_FL", jurisdiction: "FL", form_id: null, public_ids: [], issued_at: now, expires_at: now,
      signature: null, content_url: null, counts: { due: 0, new: 0 }, sharing_notice_ack: false,
    };
    const fetchImpl = (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
    expect(await fetchBatchItems(res, fetchImpl)).toEqual([]);
  });
});

describe("mock-start with a published form", () => {
  it("reads title, time and pass score from the response", () => {
    const res = parseMockStart({
      session: { id: "6f1a2b3c-4d5e-4f60-8a71-0b1c2d3e4f50", form_id: "full", jurisdiction: "FL", item_ids: ["a", "b"], portions: [{ portion: "national", bank: "national_pearsonvue", public_ids: ["a", "b"], pass_score: 0.7 }] },
      batches: [],
      title: "Full national mock · Pearson VUE (80 questions)",
      time_limit_s: 9000,
      time_limit_ms: 9_000_000,
      pass_score: 0.7,
      form: { source: "published", id: "national_pearsonvue:NAT:full" },
    });
    expect(res).toMatchObject({ title: "Full national mock · Pearson VUE (80 questions)", time_limit_s: 9000, pass_score: 0.7, form_id: "full" });
    expect(res!.portions![0]!.pass_score).toBe("70%");
  });
});
