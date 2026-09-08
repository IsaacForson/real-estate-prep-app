/**
 * POST /functions/v1/webhook-lemonsqueezy — Lemon Squeezy webhooks (web sales, SPEC §7).
 * verify_jwt = false in config.toml; authenticity comes from X-Signature (hmac-sha256 hex of
 * the raw body with LEMONSQUEEZY_WEBHOOK_SECRET).
 *
 * subscribe to: order_created, order_refunded. at checkout pass
 * `checkout[custom][user_id] = <supabase uid>` so it arrives as meta.custom_data.user_id.
 * lemon squeezy payloads carry no event id, so `<event_name>:<order id>` is the idempotency key.
 */
import { requireEnv } from "../_shared/env.ts";
import { productMapFromEnv } from "../_shared/entitlements.ts";
import { serve } from "../_shared/response.ts";
import { jsonObj, jsonStr, runWebhook } from "../_shared/webhook-handler.ts";
import { lemonSqueezyActions, verifyLemonSqueezySignature } from "../_shared/webhooks.ts";

serve((req) =>
  runWebhook(req, {
    provider: "lemonsqueezy",
    verify: (raw, headers) =>
      verifyLemonSqueezySignature(raw, headers.get("x-signature"), requireEnv("LEMONSQUEEZY_WEBHOOK_SECRET")),
    eventId: (e) => {
      const name = jsonStr(jsonObj(e.meta).event_name);
      const id = jsonStr(jsonObj(e.data).id);
      return name && id ? `${name}:${id}` : null;
    },
    eventType: (e) => jsonStr(jsonObj(e.meta).event_name) ?? "unknown",
    actions: (e) => lemonSqueezyActions(e, productMapFromEnv("LEMONSQUEEZY_VARIANT_ID")),
  })
);
