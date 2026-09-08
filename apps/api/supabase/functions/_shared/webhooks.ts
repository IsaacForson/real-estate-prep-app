/**
 * Payment-provider webhook verification and event → entitlement-action mapping. Pure: no
 * network, no db. Each verifier documents the provider scheme it implements and the date it
 * was checked against the provider docs.
 */
import { hmacSha256Hex, timingSafeEqual } from "./hmac.ts";

export type Product = "complete" | "pass_guarantee";
export type Source = "paddle" | "lemonsqueezy" | "revenuecat_ios" | "revenuecat_android" | "manual";

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export const DEFAULT_TOLERANCE_SECONDS = 300;

// ---------------------------------------------------------------------------
// paddle billing (checked 2026-09-08, developer.paddle.com/webhooks/signature-verification)
//   header  Paddle-Signature: ts=<unix seconds>;h1=<hex hmac>[;h1=<hex hmac>]
//   signed  `${ts}:${rawBody}`  with the notification-destination secret (pdl_ntfset_...)
//   algo    hmac-sha256, hex. multiple h1 values appear during secret rotation.
//   replay  paddle sdks default to a 5 s tolerance; we allow 300 s for clock skew.
// ---------------------------------------------------------------------------
export function parsePaddleSignature(header: string | null): { ts: number; h1: string[] } | null {
  if (!header) return null;
  let ts: number | null = null;
  const h1: string[] = [];
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "ts" && v) ts = Number.parseInt(v, 10);
    else if (k === "h1" && v) h1.push(v.toLowerCase());
  }
  if (ts === null || !Number.isFinite(ts) || h1.length === 0) return null;
  return { ts, h1 };
}

export async function verifyPaddleSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs: number = Date.now(),
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): Promise<VerifyResult> {
  const parsed = parsePaddleSignature(header);
  if (!parsed) return { ok: false, reason: "missing_or_malformed_signature" };
  if (Math.abs(nowMs / 1000 - parsed.ts) > toleranceSeconds) return { ok: false, reason: "timestamp_out_of_tolerance" };
  const expected = await hmacSha256Hex(secret, `${parsed.ts}:${rawBody}`);
  return parsed.h1.some((h) => timingSafeEqual(h, expected)) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

// ---------------------------------------------------------------------------
// lemon squeezy (checked 2026-09-08 against lmsqueezy/laravel VerifyWebhookSignature; the docs
// site returned 403 to automated fetches — confirm at docs.lemonsqueezy.com/help/webhooks)
//   header  X-Signature: <hex hmac>
//   signed  raw body, with the signing secret typed into the webhook form
//   algo    hmac-sha256, hex. no timestamp: rely on the idempotency table for replay.
// ---------------------------------------------------------------------------
export async function verifyLemonSqueezySignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<VerifyResult> {
  if (!header || !/^[0-9a-f]{64}$/i.test(header.trim())) return { ok: false, reason: "missing_or_malformed_signature" };
  const expected = await hmacSha256Hex(secret, rawBody);
  return timingSafeEqual(header.trim().toLowerCase(), expected) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

// ---------------------------------------------------------------------------
// revenuecat (checked 2026-09-08, revenuecat.com/docs/webhooks)
//   Authorization: <arbitrary value configured in the dashboard>; compare exactly.
//   optional X-RevenueCat-Webhook-Signature: t=<unix seconds>,v1=<hex hmac>
//     signed `${t}.${rawBody}` with the integration's signing secret, hmac-sha256 hex.
// ---------------------------------------------------------------------------
export function parseRevenueCatSignature(header: string | null): { t: number; v1: string[] } | null {
  if (!header) return null;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && v) t = Number.parseInt(v, 10);
    else if (k === "v1" && v) v1.push(v.toLowerCase());
  }
  if (t === null || !Number.isFinite(t) || v1.length === 0) return null;
  return { t, v1 };
}

export interface RevenueCatVerifyInput {
  rawBody: string;
  authorizationHeader: string | null;
  expectedAuthorization: string;
  signatureHeader: string | null;
  /** when set, the hmac header is required and verified. */
  signingSecret: string | null;
  nowMs?: number;
  toleranceSeconds?: number;
}

export async function verifyRevenueCat(i: RevenueCatVerifyInput): Promise<VerifyResult> {
  if (!i.expectedAuthorization) return { ok: false, reason: "server_missing_auth_config" };
  if (!i.authorizationHeader || !timingSafeEqual(i.authorizationHeader.trim(), i.expectedAuthorization.trim())) {
    return { ok: false, reason: "bad_authorization" };
  }
  if (i.signingSecret) {
    const parsed = parseRevenueCatSignature(i.signatureHeader);
    if (!parsed) return { ok: false, reason: "missing_or_malformed_signature" };
    const now = (i.nowMs ?? Date.now()) / 1000;
    if (Math.abs(now - parsed.t) > (i.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)) {
      return { ok: false, reason: "timestamp_out_of_tolerance" };
    }
    const expected = await hmacSha256Hex(i.signingSecret, `${parsed.t}.${i.rawBody}`);
    if (!parsed.v1.some((v) => timingSafeEqual(v, expected))) return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// event → action mapping
// ---------------------------------------------------------------------------

export interface UserHint {
  user_id: string | null; // our supabase uid, passed through checkout custom_data / rc app_user_id
  email: string | null;
}

export type EntitlementAction =
  | {
    kind: "grant";
    product: Product;
    source: Source;
    external_id: string;
    external_customer_id: string | null;
    user: UserHint;
    meta: Record<string, unknown>;
  }
  | { kind: "revoke"; source: Source; external_id: string; reason: string; product: Product | null }
  | { kind: "transfer"; source: Source; from_user_ids: string[]; to_user_ids: string[] }
  | { kind: "ignore"; why: string };

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const str = (
  x: unknown,
): string | null => (typeof x === "string" && x.length > 0 ? x : typeof x === "number" ? String(x) : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function asUserId(x: unknown): string | null {
  return typeof x === "string" && UUID_RE.test(x) ? x.toLowerCase() : null;
}

/** paddle: transaction.completed grants; approved refund / chargeback adjustments revoke. */
export function paddleActions(event: Json, priceMap: Record<string, Product>): EntitlementAction[] {
  const type = str(event.event_type) ?? "";
  const data = obj(event.data);
  if (type === "transaction.completed" || type === "transaction.paid") {
    if (type === "transaction.paid") return [{ kind: "ignore", why: "wait for transaction.completed" }];
    const txn = str(data.id);
    if (!txn) return [{ kind: "ignore", why: "no transaction id" }];
    const custom = obj(data.custom_data);
    const user: UserHint = { user_id: asUserId(custom.user_id), email: str(custom.email) };
    const out: EntitlementAction[] = [];
    for (const it of arr(data.items)) {
      const price = obj(obj(it).price);
      const product = priceMap[str(price.id) ?? ""];
      if (!product) continue;
      out.push({
        kind: "grant",
        product,
        source: "paddle",
        external_id: txn,
        external_customer_id: str(data.customer_id),
        user,
        meta: { price_id: str(price.id), currency: str(data.currency_code), origin: str(data.origin) },
      });
    }
    return out.length ? out : [{ kind: "ignore", why: "no mapped price in transaction" }];
  }
  if (type === "adjustment.created" || type === "adjustment.updated") {
    const action = str(data.action) ?? "";
    const status = str(data.status) ?? "";
    const txn = str(data.transaction_id);
    if (!txn) return [{ kind: "ignore", why: "adjustment without transaction id" }];
    const isReversal = action === "refund" || action === "chargeback";
    if (!isReversal) return [{ kind: "ignore", why: `adjustment action ${action}` }];
    if (action === "refund" && status !== "approved") return [{ kind: "ignore", why: `refund status ${status}` }];
    const partial = arr(data.items).some((it) => str(obj(it).type) === "partial");
    if (partial) return [{ kind: "ignore", why: "partial refund; revoke manually if warranted" }];
    return [{ kind: "revoke", source: "paddle", external_id: txn, reason: action, product: null }];
  }
  return [{ kind: "ignore", why: `unhandled event ${type}` }];
}

/** lemon squeezy: order_created (status paid) grants; order_refunded revokes. */
export function lemonSqueezyActions(event: Json, variantMap: Record<string, Product>): EntitlementAction[] {
  const meta = obj(event.meta);
  const name = str(meta.event_name) ?? "";
  const data = obj(event.data);
  const attrs = obj(data.attributes);
  const orderId = str(data.id);
  if (!orderId) return [{ kind: "ignore", why: "no order id" }];
  if (name === "order_created") {
    if (str(attrs.status) !== "paid") return [{ kind: "ignore", why: `order status ${str(attrs.status)}` }];
    if (attrs.refunded === true) return [{ kind: "ignore", why: "order already refunded" }];
    const custom = obj(meta.custom_data);
    const user: UserHint = { user_id: asUserId(custom.user_id), email: str(attrs.user_email) };
    const variant = str(obj(attrs.first_order_item).variant_id);
    const product = variantMap[variant ?? ""];
    if (!product) return [{ kind: "ignore", why: `unmapped variant ${variant}` }];
    return [{
      kind: "grant",
      product,
      source: "lemonsqueezy",
      external_id: orderId,
      external_customer_id: str(attrs.customer_id),
      user,
      meta: { variant_id: variant, identifier: str(attrs.identifier), currency: str(attrs.currency) },
    }];
  }
  if (name === "order_refunded") {
    return [{ kind: "revoke", source: "lemonsqueezy", external_id: orderId, reason: "refund", product: null }];
  }
  return [{ kind: "ignore", why: `unhandled event ${name}` }];
}

export function revenueCatSource(store: string | null): Source | null {
  if (store === "APP_STORE" || store === "MAC_APP_STORE") return "revenuecat_ios";
  if (store === "PLAY_STORE") return "revenuecat_android";
  return null;
}

export interface RevenueCatOptions {
  productMap: Record<string, Product>;
  allowSandbox: boolean;
}

/**
 * revenuecat: purchases grant; CANCELLATION with cancel_reason CUSTOMER_SUPPORT (the refund
 * signal for non-subscription products) and EXPIRATION revoke; TRANSFER moves entitlements.
 * app_user_id must be our supabase uid (client calls Purchases.logIn(uid)); anonymous ids are
 * reported as unmatched so support can reconcile.
 */
export function revenueCatActions(payload: Json, o: RevenueCatOptions): EntitlementAction[] {
  const ev = obj(payload.event);
  const type = str(ev.type) ?? "";
  if (type === "TEST") return [{ kind: "ignore", why: "test event" }];
  if (str(ev.environment) === "SANDBOX" && !o.allowSandbox) return [{ kind: "ignore", why: "sandbox event" }];

  if (type === "TRANSFER") {
    return [{
      kind: "transfer",
      source: revenueCatSource(str(ev.store)) ?? "revenuecat_ios",
      from_user_ids: arr(ev.transferred_from).map(asUserId).filter((x): x is string => x !== null),
      to_user_ids: arr(ev.transferred_to).map(asUserId).filter((x): x is string => x !== null),
    }];
  }

  const source = revenueCatSource(str(ev.store));
  if (!source) return [{ kind: "ignore", why: `store ${str(ev.store)} not handled` }];
  const externalId = str(ev.transaction_id) ?? str(ev.original_transaction_id) ?? str(ev.id);
  if (!externalId) return [{ kind: "ignore", why: "no transaction id" }];

  // product: prefer explicit entitlement ids (configured in rc to equal our product names).
  const products = new Set<Product>();
  for (const e of arr(ev.entitlement_ids)) {
    if (e === "complete" || e === "pass_guarantee") products.add(e);
  }
  const mapped = o.productMap[str(ev.product_id) ?? ""];
  if (mapped) products.add(mapped);
  if (products.size === 0) return [{ kind: "ignore", why: `unmapped product ${str(ev.product_id)}` }];

  const grants = ["INITIAL_PURCHASE", "NON_RENEWING_PURCHASE", "RENEWAL", "UNCANCELLATION", "REFUND_REVERSED"];
  if (grants.includes(type)) {
    const user: UserHint = { user_id: asUserId(ev.app_user_id) ?? asUserId(ev.original_app_user_id), email: null };
    return [...products].map((product) => ({
      kind: "grant" as const,
      product,
      source,
      external_id: externalId,
      external_customer_id: str(ev.app_user_id),
      user,
      meta: {
        rc_event_type: type,
        product_id: str(ev.product_id),
        store: str(ev.store),
        environment: str(ev.environment),
      },
    }));
  }
  if (type === "CANCELLATION") {
    if (str(ev.cancel_reason) !== "CUSTOMER_SUPPORT") {
      return [{ kind: "ignore", why: `cancellation reason ${str(ev.cancel_reason)}` }];
    }
    return [{ kind: "revoke", source, external_id: externalId, reason: "refund", product: null }];
  }
  if (type === "EXPIRATION") {
    return [{ kind: "revoke", source, external_id: externalId, reason: "expiration", product: null }];
  }
  return [{ kind: "ignore", why: `unhandled event ${type}` }];
}
