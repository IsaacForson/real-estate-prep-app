/**
 * One runner for all three payment webhooks: read raw body → verify → parse → idempotency
 * insert → map to actions → apply → record result. Providers retry on non-2xx, so:
 *   * signature failures answer 401 (a retry will fail the same way; fine)
 *   * events we do not care about answer 200 "ignored"
 *   * an unmatched user answers 200 "unmatched_user" and keeps the payload for support
 *   * a processing error answers 500 and marks the row so the retry is processed again
 */
import { type Db, serviceClient } from "./db.ts";
import { applyActions, markWebhookProcessed, type Provider, recordWebhookEvent } from "./entitlements.ts";
import { errorResponse, json } from "./response.ts";
import type { EntitlementAction, VerifyResult } from "./webhooks.ts";

type Json = Record<string, unknown>;

export interface WebhookSpec {
  provider: Provider;
  verify: (rawBody: string, headers: Headers) => Promise<VerifyResult>;
  eventId: (event: Json) => string | null;
  eventType: (event: Json) => string;
  actions: (event: Json) => EntitlementAction[];
}

export async function runWebhook(req: Request, spec: WebhookSpec, db: Db = serviceClient()): Promise<Response> {
  const raw = await req.text();
  const verified = await spec.verify(raw, req.headers);
  if (!verified.ok) {
    console.warn(`[${spec.provider}] rejected webhook: ${verified.reason}`);
    return errorResponse(401, "bad_signature", verified.reason);
  }

  let event: Json;
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    event = parsed as Json;
  } catch {
    return errorResponse(400, "invalid_json", "webhook body must be a json object");
  }

  const eventId = spec.eventId(event);
  if (!eventId) return errorResponse(400, "missing_event_id", "could not derive an event id");
  const eventType = spec.eventType(event);

  const rec = await recordWebhookEvent(db, spec.provider, eventId, eventType, event);
  if (rec.duplicate) return json({ ok: true, duplicate: true, event_id: eventId });

  try {
    const outcome = await applyActions(db, spec.actions(event));
    await markWebhookProcessed(db, rec.row_id, `${outcome.summary}: ${outcome.results.join(" | ")}`);
    return json({ ok: true, event_id: eventId, result: outcome.summary, details: outcome.results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${spec.provider}] processing failed for ${eventId}: ${msg}`);
    // leave processed_at null and record the error so a provider retry is processed again.
    await markWebhookProcessed(db, rec.row_id, `error: ${msg}`, { keepUnprocessed: true });
    return errorResponse(500, "processing_failed", "webhook accepted but processing failed; provider will retry");
  }
}

export const jsonStr = (x: unknown): string | null =>
  typeof x === "string" && x.length > 0 ? x : typeof x === "number" ? String(x) : null;
export const jsonObj = (
  x: unknown,
): Json => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
