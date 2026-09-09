/**
 * POST /functions/v1/create-checkout — start a web purchase (Complete or the pass guarantee).
 *
 * Native IAP stays on RevenueCat. Web sales go through the merchant of record already wired for
 * webhooks (Paddle Billing, else Lemon Squeezy). The returned url is opened by the client; we never
 * take a card number ourselves.
 *
 * body: { product: "complete" | "pass_guarantee" }
 * returns: { url, provider }
 */
import { authenticate, getEntitlements } from "../_shared/auth.ts";
import { optionalEnv } from "../_shared/env.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";

type Product = "complete" | "pass_guarantee";

function productOf(v: unknown): Product {
  if (v === "complete" || v === "pass_guarantee") return v;
  throw new HttpError(400, "invalid_product", "product must be complete or pass_guarantee");
}

async function paddleCheckout(product: Product, userId: string, email: string | null): Promise<string | null> {
  const key = optionalEnv("PADDLE_API_KEY");
  const price = product === "complete" ? optionalEnv("PADDLE_PRICE_ID_COMPLETE") : optionalEnv("PADDLE_PRICE_ID_PASS_GUARANTEE");
  if (!key || !price) return null;
  const res = await fetch("https://api.paddle.com/transactions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      items: [{ price_id: price, quantity: 1 }],
      custom_data: { user_id: userId },
      checkout: { url: true },
      ...(email ? { customer: { email } } : {}),
    }),
  });
  const body = await res.json() as { data?: { checkout?: { url?: string } }; error?: { detail?: string } };
  const url = body.data?.checkout?.url;
  if (!res.ok || !url) {
    throw new HttpError(502, "paddle_checkout_failed", body.error?.detail ?? "Paddle did not return a checkout url");
  }
  return url;
}

async function lemonCheckout(product: Product, userId: string, email: string | null): Promise<string | null> {
  const key = optionalEnv("LEMONSQUEEZY_API_KEY");
  const store = optionalEnv("LEMONSQUEEZY_STORE_ID");
  const variant = product === "complete"
    ? optionalEnv("LEMONSQUEEZY_VARIANT_ID_COMPLETE")
    : optionalEnv("LEMONSQUEEZY_VARIANT_ID_PASS_GUARANTEE");
  if (key && store && variant) {
    const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: {
        accept: "application/vnd.api+json",
        "content-type": "application/vnd.api+json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        data: {
          type: "checkouts",
          attributes: {
            checkout_data: {
              email: email ?? undefined,
              custom: { user_id: userId },
            },
          },
          relationships: {
            store: { data: { type: "stores", id: store } },
            variant: { data: { type: "variants", id: variant } },
          },
        },
      }),
    });
    const body = await res.json() as { data?: { attributes?: { url?: string } }; errors?: Array<{ detail?: string }> };
    const url = body.data?.attributes?.url;
    if (!res.ok || !url) {
      throw new HttpError(502, "lemonsqueezy_checkout_failed", body.errors?.[0]?.detail ?? "Lemon Squeezy did not return a checkout url");
    }
    return url;
  }
  const buy = product === "complete" ? optionalEnv("LEMONSQUEEZY_BUY_URL_COMPLETE") : optionalEnv("LEMONSQUEEZY_BUY_URL_PASS_GUARANTEE");
  if (!buy) return null;
  const url = new URL(buy);
  url.searchParams.set("checkout[custom][user_id]", userId);
  if (email) url.searchParams.set("checkout[email]", email);
  return url.toString();
}

serve(async (req) => {
  const ctx = await authenticate(req);
  const product = productOf((await readJsonObject(req)).product);
  const ent = await getEntitlements(ctx.db, ctx.userId);

  if (product === "complete" && ent.complete) throw new HttpError(409, "already_owned", "this account already has Complete");
  if (product === "pass_guarantee" && !ent.complete) {
    throw new HttpError(403, "requires_complete", "the pass guarantee is an add-on on top of Complete");
  }
  if (product === "pass_guarantee" && ent.passGuarantee) {
    throw new HttpError(409, "already_owned", "this account already has the pass guarantee");
  }

  const email = ctx.email;
  const paddle = await paddleCheckout(product, ctx.userId, email);
  if (paddle) return json({ url: paddle, provider: "paddle" });
  const lemon = await lemonCheckout(product, ctx.userId, email);
  if (lemon) return json({ url: lemon, provider: "lemonsqueezy" });

  throw new HttpError(
    503,
    "checkout_not_configured",
    "web checkout is not configured on this project yet. set Paddle or Lemon Squeezy keys, or buy in the Android app with the same email.",
  );
});
