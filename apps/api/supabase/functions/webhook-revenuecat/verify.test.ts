import { assertEquals } from "@std/assert";
import { hmacSha256Hex } from "../_shared/hmac.ts";
import { parseRevenueCatSignature, revenueCatActions, verifyRevenueCat } from "../_shared/webhooks.ts";

const raw = JSON.stringify({ api_version: "1.0", event: { id: "ev1", type: "INITIAL_PURCHASE" } });
const t = 1_757_332_800;
const nowMs = t * 1000 + 1_000;

Deno.test("verifyRevenueCat: authorization header compare", async () => {
  assertEquals(
    await verifyRevenueCat({
      rawBody: raw,
      authorizationHeader: "Bearer abc",
      expectedAuthorization: "Bearer abc",
      signatureHeader: null,
      signingSecret: null,
    }),
    { ok: true },
  );
  assertEquals(
    (await verifyRevenueCat({
      rawBody: raw,
      authorizationHeader: "Bearer abd",
      expectedAuthorization: "Bearer abc",
      signatureHeader: null,
      signingSecret: null,
    })).ok,
    false,
  );
  assertEquals(
    await verifyRevenueCat({
      rawBody: raw,
      authorizationHeader: "x",
      expectedAuthorization: "",
      signatureHeader: null,
      signingSecret: null,
    }),
    { ok: false, reason: "server_missing_auth_config" },
  );
});

Deno.test("verifyRevenueCat: optional hmac over `t.body`", async () => {
  const v1 = await hmacSha256Hex("rc-secret", `${t}.${raw}`);
  const base = {
    rawBody: raw,
    authorizationHeader: "tok",
    expectedAuthorization: "tok",
    signingSecret: "rc-secret",
    nowMs,
  };
  assertEquals(await verifyRevenueCat({ ...base, signatureHeader: `t=${t},v1=${v1}` }), { ok: true });
  assertEquals(await verifyRevenueCat({ ...base, signatureHeader: `t=${t},v1=00` }), {
    ok: false,
    reason: "bad_signature",
  });
  assertEquals(await verifyRevenueCat({ ...base, signatureHeader: null }), {
    ok: false,
    reason: "missing_or_malformed_signature",
  });
  assertEquals(
    await verifyRevenueCat({ ...base, signatureHeader: `t=${t},v1=${v1}`, nowMs: nowMs + 3600_000 }),
    { ok: false, reason: "timestamp_out_of_tolerance" },
  );
  assertEquals(parseRevenueCatSignature("t=5,v1=AB"), { t: 5, v1: ["ab"] });
});

const uid = "8c1a4c2e-9f4c-4d8e-8a1e-0b2c3d4e5f60";
const opts = { productMap: { rep_complete: "complete" as const }, allowSandbox: false };

Deno.test("revenueCatActions: purchases grant with the right source per store", () => {
  const ios = revenueCatActions(
    {
      event: {
        id: "e1",
        type: "INITIAL_PURCHASE",
        app_user_id: uid,
        product_id: "rep_complete",
        entitlement_ids: ["complete"],
        store: "APP_STORE",
        environment: "PRODUCTION",
        transaction_id: "tx1",
      },
    },
    opts,
  );
  assertEquals(ios.length, 1);
  if (ios[0]?.kind === "grant") {
    assertEquals(ios[0].source, "revenuecat_ios");
    assertEquals(ios[0].external_id, "tx1");
    assertEquals(ios[0].user.user_id, uid);
  } else throw new Error("expected grant");

  const android = revenueCatActions(
    {
      event: {
        id: "e2",
        type: "NON_RENEWING_PURCHASE",
        app_user_id: uid,
        product_id: "rep_complete",
        entitlement_ids: [],
        store: "PLAY_STORE",
        environment: "PRODUCTION",
        transaction_id: "GPA.1",
      },
    },
    opts,
  );
  if (android[0]?.kind === "grant") assertEquals(android[0].source, "revenuecat_android");
  else throw new Error("expected grant");
});

Deno.test("revenueCatActions: refund (CANCELLATION/CUSTOMER_SUPPORT) revokes; other cancellations ignored", () => {
  const refund = revenueCatActions(
    {
      event: {
        id: "e3",
        type: "CANCELLATION",
        cancel_reason: "CUSTOMER_SUPPORT",
        app_user_id: uid,
        product_id: "rep_complete",
        store: "APP_STORE",
        environment: "PRODUCTION",
        transaction_id: "tx1",
      },
    },
    opts,
  );
  assertEquals(refund, [{
    kind: "revoke",
    source: "revenuecat_ios",
    external_id: "tx1",
    reason: "refund",
    product: null,
  }]);
  const unsub = revenueCatActions(
    {
      event: {
        id: "e4",
        type: "CANCELLATION",
        cancel_reason: "UNSUBSCRIBE",
        app_user_id: uid,
        product_id: "rep_complete",
        store: "APP_STORE",
        environment: "PRODUCTION",
        transaction_id: "tx1",
      },
    },
    opts,
  );
  assertEquals(unsub[0]?.kind, "ignore");
});

Deno.test("revenueCatActions: transfer, sandbox, test, anonymous users", () => {
  const other = "3f0b0a2e-6a57-4a1e-9b1a-1f4c3a2b1c00";
  assertEquals(
    revenueCatActions({
      event: { id: "e5", type: "TRANSFER", store: "APP_STORE", transferred_from: [uid], transferred_to: [other] },
    }, opts),
    [{ kind: "transfer", source: "revenuecat_ios", from_user_ids: [uid], to_user_ids: [other] }],
  );
  assertEquals(revenueCatActions({ event: { id: "e6", type: "TEST" } }, opts)[0]?.kind, "ignore");
  assertEquals(
    revenueCatActions({
      event: {
        id: "e7",
        type: "INITIAL_PURCHASE",
        environment: "SANDBOX",
        app_user_id: uid,
        product_id: "rep_complete",
        store: "APP_STORE",
      },
    }, opts)[0]?.kind,
    "ignore",
  );
  assertEquals(
    revenueCatActions({
      event: {
        id: "e8",
        type: "INITIAL_PURCHASE",
        environment: "SANDBOX",
        app_user_id: uid,
        product_id: "rep_complete",
        store: "APP_STORE",
        transaction_id: "t",
      },
    }, { ...opts, allowSandbox: true })[0]?.kind,
    "grant",
  );
  // anonymous rc id: grant action with no user, applyActions reports unmatched_user
  const anon = revenueCatActions(
    {
      event: {
        id: "e9",
        type: "INITIAL_PURCHASE",
        app_user_id: "$RCAnonymousID:abc",
        product_id: "rep_complete",
        store: "APP_STORE",
        environment: "PRODUCTION",
        transaction_id: "t",
      },
    },
    opts,
  );
  if (anon[0]?.kind === "grant") assertEquals(anon[0].user.user_id, null);
  else throw new Error("expected grant");
});
