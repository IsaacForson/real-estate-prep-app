import { describe, it, expect } from "vitest";
import { parseBatchItem, fetchBatchItems, type IssueBatchResponse } from "../lib/study/itemSource.js";
import { ApiError, callFunction, isFreeTierError, isSessionRevoked } from "../lib/study/api.js";

const rawItem = {
  jurisdiction: "FL", bank: "state_FL", blueprint_node: "1.1", vendor: "pearsonvue", cognitive_level: "knowledge",
  stem: "Under Florida law, which act by a licensee is grounds for discipline?",
  options: ["Paying a referral fee to an unlicensed person", "Advertising under the brokerage name", "Depositing escrow within 3 business days", "Disclosing a material defect"],
  key: "A",
  explanation: "Chapter 475 prohibits sharing compensation with anyone not licensed; the other choices describe compliant conduct.",
  citation: { source: "Fla. Stat. § 475.25(1)(h)", url: null, quoted_text: "has shared a commission with, or paid a fee or other compensation to, a person not properly licensed" },
};

describe("batch items carry public ids", () => {
  it("validates an item with the schema and stamps the public id back", () => {
    const item = parseBatchItem(rawItem, "k7Qz2mP9aB1c");
    expect(item).not.toBeNull();
    expect(item!.id).toBe("k7Qz2mP9aB1c");
    expect(item!.bank).toBe("state_FL");
    expect(item!.reviewer).toBe("redacted");
  });
  it("rejects malformed content (the api stub, or a broken document)", () => {
    expect(parseBatchItem({ public_id: "x", stem: null, options: null }, "x")).toBeNull();
    expect(parseBatchItem({ ...rawItem, options: ["a", "b"] }, "x")).toBeNull();
  });
  it("downloads the signed document and keeps only signed public ids", async () => {
    const res: IssueBatchResponse = {
      batch_id: "b", kind: "practice", bank: "state_FL", jurisdiction: "FL", form_id: null, public_ids: ["p1", "p2"],
      issued_at: "2026-09-08T00:00:00Z", expires_at: "2026-09-08T06:00:00Z", signature: "sig", content_url: "https://signed/x.json",
      counts: { due: 0, new: 2 }, free_tier: null, sharing_notice_ack: false,
    };
    const fetchImpl = (async () => new Response(JSON.stringify({ items: [{ ...rawItem, id: "p1" }, { ...rawItem, id: "p2" }, { ...rawItem, id: "not-signed" }] }))) as unknown as typeof fetch;
    const items = await fetchBatchItems(res, fetchImpl);
    expect(items.map((i) => i.id)).toEqual(["p1", "p2"]);
    const stub = (async () => new Response(JSON.stringify({ items: [{ public_id: "p1", stem: null }] }))) as unknown as typeof fetch;
    await expect(fetchBatchItems(res, stub)).rejects.toMatchObject({ code: "batch_content_unavailable" });
  });
});

describe("function errors", () => {
  it("turns the api error envelope into ApiError with its code", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { code: "session_revoked", message: "elsewhere" } }), { status: 401 })) as unknown as typeof fetch;
    const p = callFunction("https://x/functions/v1", "issue-batch", {}, {}, fetchImpl);
    await expect(p).rejects.toBeInstanceOf(ApiError);
    await expect(p).rejects.toMatchObject({ status: 401, code: "session_revoked" });
    const e = await p.catch((x) => x);
    expect(isSessionRevoked(e)).toBe(true);
    expect(isFreeTierError(new ApiError(402, "free_tier_exhausted"))).toBe(true);
    expect(isFreeTierError(new ApiError(429, "rate_limited"))).toBe(false);
  });
});
