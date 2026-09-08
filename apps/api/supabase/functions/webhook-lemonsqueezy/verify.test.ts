import { assertEquals } from "@std/assert";
import { hmacSha256Hex } from "../_shared/hmac.ts";
import { lemonSqueezyActions, verifyLemonSqueezySignature } from "../_shared/webhooks.ts";

const secret = "ls-signing-secret";
const body = JSON.stringify({ meta: { event_name: "order_created" }, data: { id: "123" } });

Deno.test("verifyLemonSqueezySignature: hex hmac of the raw body", async () => {
  const sig = await hmacSha256Hex(secret, body);
  assertEquals(await verifyLemonSqueezySignature(body, sig, secret), { ok: true });
  assertEquals(await verifyLemonSqueezySignature(body, sig.toUpperCase(), secret), { ok: true });
  assertEquals(await verifyLemonSqueezySignature(body + "\n", sig, secret), { ok: false, reason: "bad_signature" });
  assertEquals(await verifyLemonSqueezySignature(body, sig, "nope"), { ok: false, reason: "bad_signature" });
  assertEquals(await verifyLemonSqueezySignature(body, null, secret), {
    ok: false,
    reason: "missing_or_malformed_signature",
  });
  assertEquals(await verifyLemonSqueezySignature(body, "not-hex", secret), {
    ok: false,
    reason: "missing_or_malformed_signature",
  });
});

const variantMap = { "111": "complete" as const, "222": "pass_guarantee" as const };

Deno.test("lemonSqueezyActions: paid order grants by variant, refunded order revokes", () => {
  const paid = lemonSqueezyActions(
    {
      meta: { event_name: "order_created", custom_data: { user_id: "8c1a4c2e-9f4c-4d8e-8a1e-0b2c3d4e5f60" } },
      data: {
        id: "555",
        attributes: {
          status: "paid",
          refunded: false,
          user_email: "a@b.c",
          customer_id: 9,
          currency: "USD",
          identifier: "abc",
          first_order_item: { variant_id: 111 },
        },
      },
    },
    variantMap,
  );
  assertEquals(paid.length, 1);
  if (paid[0]?.kind === "grant") {
    assertEquals(paid[0].product, "complete");
    assertEquals(paid[0].external_id, "555");
    assertEquals(paid[0].user, { user_id: "8c1a4c2e-9f4c-4d8e-8a1e-0b2c3d4e5f60", email: "a@b.c" });
    assertEquals(paid[0].source, "lemonsqueezy");
  } else throw new Error("expected grant");

  assertEquals(
    lemonSqueezyActions({ meta: { event_name: "order_refunded" }, data: { id: "555", attributes: {} } }, variantMap),
    [{ kind: "revoke", source: "lemonsqueezy", external_id: "555", reason: "refund", product: null }],
  );
  assertEquals(
    lemonSqueezyActions({
      meta: { event_name: "order_created" },
      data: { id: "556", attributes: { status: "pending", first_order_item: { variant_id: 111 } } },
    }, variantMap)[0]?.kind,
    "ignore",
  );
  assertEquals(
    lemonSqueezyActions({
      meta: { event_name: "order_created" },
      data: { id: "557", attributes: { status: "paid", first_order_item: { variant_id: 999 } } },
    }, variantMap)[0]?.kind,
    "ignore",
  );
  assertEquals(
    lemonSqueezyActions({ meta: { event_name: "subscription_created" }, data: { id: "1" } }, variantMap)[0]?.kind,
    "ignore",
  );
});
