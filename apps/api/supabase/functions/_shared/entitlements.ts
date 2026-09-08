/**
 * Webhook → database glue shared by the three payment webhooks. Idempotency: the raw event is
 * inserted into webhook_events first (unique on provider + event id); a conflict means we have
 * already processed it and we answer 200 without touching entitlements.
 */
import { type Db, rpc } from "./db.ts";
import type { EntitlementAction } from "./webhooks.ts";

export type Provider = "paddle" | "lemonsqueezy" | "revenuecat";

export interface RecordedEvent {
  duplicate: boolean;
  row_id: string | null;
}

export async function recordWebhookEvent(
  db: Db,
  provider: Provider,
  eventId: string,
  eventType: string,
  payload: unknown,
): Promise<RecordedEvent> {
  const { data, error } = await db
    .from("webhook_events")
    .insert({ provider, event_id: eventId, event_type: eventType, payload })
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code !== "23505") throw new Error(`webhook_events insert failed: ${error.message}`); // 23505 = unique_violation
    // seen before. if the earlier attempt failed (processed_at still null) let the retry run.
    const { data: existing } = await db
      .from("webhook_events")
      .select("id, processed_at")
      .eq("provider", provider)
      .eq("event_id", eventId)
      .maybeSingle();
    const row = existing as { id: string; processed_at: string | null } | null;
    if (row && row.processed_at === null) return { duplicate: false, row_id: row.id };
    return { duplicate: true, row_id: row?.id ?? null };
  }
  return { duplicate: false, row_id: (data as { id: string } | null)?.id ?? null };
}

export async function markWebhookProcessed(
  db: Db,
  rowId: string | null,
  result: string,
  opts: { keepUnprocessed?: boolean } = {},
): Promise<void> {
  if (!rowId) return;
  const patch: Record<string, unknown> = { result };
  if (!opts.keepUnprocessed) patch.processed_at = new Date().toISOString();
  await db.from("webhook_events").update(patch).eq("id", rowId);
}

/** Resolve a provider's user hint to a supabase uid. */
export async function resolveUserId(
  db: Db,
  hint: { user_id: string | null; email: string | null },
): Promise<string | null> {
  if (hint.user_id) return hint.user_id;
  if (hint.email) {
    const id = await rpc<string | null>(db, "fn_user_id_by_email", { p_email: hint.email });
    return id ?? null;
  }
  return null;
}

export interface ApplyOutcome {
  results: string[]; // one summary per action
  summary: "granted" | "revoked" | "transferred" | "ignored" | "unmatched_user" | "mixed";
}

export async function applyActions(db: Db, actions: EntitlementAction[]): Promise<ApplyOutcome> {
  const results: string[] = [];
  const kinds = new Set<string>();
  for (const a of actions) {
    switch (a.kind) {
      case "grant": {
        const uid = await resolveUserId(db, a.user);
        if (!uid) {
          results.push(`unmatched_user:${a.external_id}`);
          kinds.add("unmatched_user");
          break;
        }
        await rpc<string>(db, "fn_grant_entitlement", {
          p_user_id: uid,
          p_product: a.product,
          p_source: a.source,
          p_external_id: a.external_id,
          p_external_customer_id: a.external_customer_id,
          p_meta: a.meta,
        });
        results.push(`granted:${a.product}:${uid}`);
        kinds.add("granted");
        break;
      }
      case "revoke": {
        const n = await rpc<number>(db, "fn_revoke_entitlement", {
          p_source: a.source,
          p_external_id: a.external_id,
          p_reason: a.reason,
          p_product: a.product,
        });
        results.push(`revoked:${n}:${a.external_id}`);
        kinds.add("revoked");
        break;
      }
      case "transfer": {
        let moved = 0;
        for (const from of a.from_user_ids) {
          for (const to of a.to_user_ids) {
            moved += await rpc<number>(db, "fn_transfer_entitlements", {
              p_from_user: from,
              p_to_user: to,
              p_source: a.source,
            });
          }
        }
        results.push(`transferred:${moved}`);
        kinds.add("transferred");
        break;
      }
      case "ignore":
        results.push(`ignored:${a.why}`);
        kinds.add("ignored");
        break;
    }
  }
  const summary = kinds.size === 1
    ? ([...kinds][0] as ApplyOutcome["summary"])
    : kinds.size === 0
    ? "ignored"
    : "mixed";
  return { results, summary };
}

/** Read a `<NAME>_<PRODUCT>` pair of env vars into a provider-id → product map. */
export function productMapFromEnv(prefix: string): Record<string, "complete" | "pass_guarantee"> {
  const map: Record<string, "complete" | "pass_guarantee"> = {};
  const complete = Deno.env.get(`${prefix}_COMPLETE`);
  const pass = Deno.env.get(`${prefix}_PASS_GUARANTEE`);
  if (complete) map[complete] = "complete";
  if (pass) map[pass] = "pass_guarantee";
  return map;
}
