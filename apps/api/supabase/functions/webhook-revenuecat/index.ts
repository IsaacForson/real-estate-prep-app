/**
 * POST /functions/v1/webhook-revenuecat — RevenueCat webhooks (ios + android iap, SPEC §7).
 * verify_jwt = false in config.toml. authenticity: the Authorization header must equal
 * REVENUECAT_WEBHOOK_AUTH; when REVENUECAT_WEBHOOK_SECRET is set the optional
 * X-RevenueCat-Webhook-Signature (t=…,v1=…, hmac-sha256 over `${t}.${rawBody}`) is verified too.
 *
 * the client must call Purchases.logIn(<supabase uid>) before purchasing so app_user_id is our
 * user id. configure the rc entitlements as "complete" and "pass_guarantee".
 * app store connect: turn Family Sharing OFF for both non-consumables (SPEC §5.3) — a store
 * setting, not something this code can enforce.
 */
import { boolEnv, optionalEnv, requireEnv } from "../_shared/env.ts";
import { productMapFromEnv } from "../_shared/entitlements.ts";
import { serve } from "../_shared/response.ts";
import { jsonObj, jsonStr, runWebhook } from "../_shared/webhook-handler.ts";
import { revenueCatActions, verifyRevenueCat } from "../_shared/webhooks.ts";

serve((req) =>
  runWebhook(req, {
    provider: "revenuecat",
    verify: (raw, headers) =>
      verifyRevenueCat({
        rawBody: raw,
        authorizationHeader: headers.get("authorization"),
        expectedAuthorization: requireEnv("REVENUECAT_WEBHOOK_AUTH"),
        signatureHeader: headers.get("x-revenuecat-webhook-signature"),
        signingSecret: optionalEnv("REVENUECAT_WEBHOOK_SECRET") || null,
      }),
    eventId: (e) => jsonStr(jsonObj(e.event).id),
    eventType: (e) => jsonStr(jsonObj(e.event).type) ?? "unknown",
    actions: (e) =>
      revenueCatActions(e, {
        productMap: productMapFromEnv("REVENUECAT_PRODUCT_ID"),
        allowSandbox: boolEnv("REVENUECAT_ALLOW_SANDBOX", false),
      }),
  })
);
