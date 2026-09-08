/**
 * Transactional email. SPEC §5.3: the response to an anomaly is a re-verification email.
 *
 * fn_open_anomaly_flag already inserts the outbox row inside the same transaction as the flag,
 * so nothing is lost if this process dies. This module is the delivery side and is a stub:
 * TODO(email): pick a provider (Resend / Postmark / SES), send `template` with `payload`,
 * then set email_outbox.sent_at. Until then rows accumulate in email_outbox and can be sent by
 * a cron worker. Do not send from the request path once a provider exists — keep it async.
 */
import type { Db } from "./db.ts";

export interface OutboxRow {
  id: string;
  user_id: string;
  template: string;
  payload: Record<string, unknown>;
}

export async function drainOutboxForUser(db: Db, userId: string, limit = 5): Promise<number> {
  const { data, error } = await db
    .from("email_outbox")
    .select("id, user_id, template, payload")
    .eq("user_id", userId)
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error || !data) return 0;
  let sent = 0;
  for (const row of data as OutboxRow[]) {
    const ok = await sendEmailStub(row);
    if (ok) {
      await db.from("email_outbox").update({ sent_at: new Date().toISOString() }).eq("id", row.id);
      sent++;
    }
  }
  return sent;
}

/** Returns true when "sent". Stub logs and reports false so rows stay queued for a real worker. */
// deno-lint-ignore require-await
async function sendEmailStub(row: OutboxRow): Promise<boolean> {
  console.info(`[email-stub] would send template=${row.template} to user=${row.user_id}`, row.payload);
  return false;
}
