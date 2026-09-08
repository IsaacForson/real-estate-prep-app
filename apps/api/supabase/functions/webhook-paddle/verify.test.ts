import { assertEquals } from "@std/assert";
import { hmacSha256Hex } from "../_shared/hmac.ts";
import { paddleActions, parsePaddleSignature, verifyPaddleSignature } from "../_shared/webhooks.ts";

const secret = "pdl_ntfset_test_secret";
const body = JSON.stringify({ event_id: "evt_1", event_type: "transaction.completed", data: { id: "txn_1" } });
const ts = 1_757_332_800; // 2025-09-08T12:00:00Z
const nowMs = ts * 1000 + 2_000;

Deno.test("parsePaddleSignature", () => {
  assertEquals(parsePaddleSignature("ts=123;h1=ABCD"), { ts: 123, h1: ["abcd"] });
  assertEquals(parsePaddleSignature("ts=123;h1=aa;h1=bb"), { ts: 123, h1: ["aa", "bb"] });
  assertEquals(parsePaddleSignature("h1=aa"), null);
  assertEquals(parsePaddleSignature(null), null);
});

Deno.test("verifyPaddleSignature accepts a correctly signed `ts:body`", async () => {
  const h1 = await hmacSha256Hex(secret, `${ts}:${body}`);
  assertEquals(await verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, secret, nowMs), { ok: true });
  // rotated secret: second h1 matches
  assertEquals(await verifyPaddleSignature(body, `ts=${ts};h1=deadbeef;h1=${h1}`, secret, nowMs), { ok: true });
});

Deno.test("verifyPaddleSignature rejects tampering, wrong secret and replay", async () => {
  const h1 = await hmacSha256Hex(secret, `${ts}:${body}`);
  assertEquals(await verifyPaddleSignature(body + " ", `ts=${ts};h1=${h1}`, secret, nowMs), {
    ok: false,
    reason: "bad_signature",
  });
  assertEquals(await verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, "other", nowMs), {
    ok: false,
    reason: "bad_signature",
  });
  assertEquals(
    await verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, secret, nowMs + 10 * 60_000),
    { ok: false, reason: "timestamp_out_of_tolerance" },
  );
  assertEquals(await verifyPaddleSignature(body, null, secret, nowMs), {
    ok: false,
    reason: "missing_or_malformed_signature",
  });
});

const priceMap = { pri_complete: "complete" as const, pri_pg: "pass_guarantee" as const };

Deno.test("paddleActions: transaction.completed grants each mapped price once", () => {
  const actions = paddleActions(
    {
      event_id: "evt_1",
      event_type: "transaction.completed",
      data: {
        id: "txn_1",
        customer_id: "ctm_1",
        currency_code: "USD",
        custom_data: { user_id: "8c1a4c2e-9f4c-4d8e-8a1e-0b2c3d4e5f60" },
        items: [{ price: { id: "pri_complete" } }, { price: { id: "pri_pg" } }, { price: { id: "pri_unknown" } }],
      },
    },
    priceMap,
  );
  assertEquals(actions.length, 2);
  assertEquals(actions[0]?.kind, "grant");
  if (actions[0]?.kind === "grant") {
    assertEquals(actions[0].product, "complete");
    assertEquals(actions[0].external_id, "txn_1");
    assertEquals(actions[0].user.user_id, "8c1a4c2e-9f4c-4d8e-8a1e-0b2c3d4e5f60");
    assertEquals(actions[0].source, "paddle");
  }
});

Deno.test("paddleActions: approved full refund revokes; partial and pending are ignored", () => {
  const base = { event_id: "evt_2", event_type: "adjustment.updated" };
  assertEquals(
    paddleActions({
      ...base,
      data: { action: "refund", status: "approved", transaction_id: "txn_1", items: [{ type: "full" }] },
    }, priceMap),
    [{ kind: "revoke", source: "paddle", external_id: "txn_1", reason: "refund", product: null }],
  );
  assertEquals(
    paddleActions({
      ...base,
      data: { action: "refund", status: "pending_approval", transaction_id: "txn_1", items: [] },
    }, priceMap)[0]?.kind,
    "ignore",
  );
  assertEquals(
    paddleActions({
      ...base,
      data: { action: "refund", status: "approved", transaction_id: "txn_1", items: [{ type: "partial" }] },
    }, priceMap)[0]?.kind,
    "ignore",
  );
  assertEquals(
    paddleActions({
      ...base,
      data: { action: "chargeback", status: "approved", transaction_id: "txn_1", items: [{ type: "full" }] },
    }, priceMap)[0],
    { kind: "revoke", source: "paddle", external_id: "txn_1", reason: "chargeback", product: null },
  );
  assertEquals(
    paddleActions({ event_id: "e", event_type: "subscription.created", data: {} }, priceMap)[0]?.kind,
    "ignore",
  );
});
