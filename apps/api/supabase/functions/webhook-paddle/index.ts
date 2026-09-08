/**
 * POST /functions/v1/webhook-paddle — Paddle Billing notifications (web sales, SPEC §7).
 * verify_jwt = false in config.toml; authenticity comes from the Paddle-Signature header
 * (ts=…;h1=…, hmac-sha256 over `${ts}:${rawBody}` with PADDLE_WEBHOOK_SECRET).
 *
 * subscribe this destination to: transaction.completed, adjustment.created, adjustment.updated.
 * at checkout, pass `custom_data: { user_id: <supabase uid> }` so the grant can be matched.
 */
import { requireEnv } from "../_shared/env.ts";
import { productMapFromEnv } from "../_shared/entitlements.ts";
import { serve } from "../_shared/response.ts";
import { jsonStr, runWebhook } from "../_shared/webhook-handler.ts";
import { paddleActions, verifyPaddleSignature } from "../_shared/webhooks.ts";

serve((req) =>
  runWebhook(req, {
    provider: "paddle",
    verify: (raw, headers) =>
      verifyPaddleSignature(raw, headers.get("paddle-signature"), requireEnv("PADDLE_WEBHOOK_SECRET")),
    eventId: (e) => jsonStr(e.event_id),
    eventType: (e) => jsonStr(e.event_type) ?? "unknown",
    actions: (e) => paddleActions(e, productMapFromEnv("PADDLE_PRICE_ID")),
  })
);
