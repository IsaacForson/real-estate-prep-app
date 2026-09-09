/**
 * POST /functions/v1/support — "contact us" threads (V2_PLAN §1 support).
 *
 * headers: Authorization: Bearer <jwt>, x-device-hash
 * body:    { op: "ticket.create", subject, body, category? }
 *          { op: "ticket.reply",  ticket_id, body }
 *          { op: "ticket.list" }
 * returns: create → { ticket }, reply → { message, ticket }, list → { tickets: (ticket + messages)[] }
 */
import { audit, authenticate, enforceRateLimit } from "../_shared/auth.ts";
import { unwrap } from "../_shared/db.ts";
import { deviceFromRequest } from "../_shared/device.ts";
import { emitEvent } from "../_shared/events.ts";
import { RATE_WINDOW_SECONDS, SUPPORT_MESSAGES_PER_HOUR } from "../_shared/limits.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";

const CATEGORIES = ["billing", "content", "bug", "account", "feature", "other"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SupportRequest extends Record<string, unknown> {
  op?: unknown;
  subject?: unknown;
  body?: unknown;
  category?: unknown;
  ticket_id?: unknown;
}

function text(x: unknown, key: string, max: number): string {
  if (typeof x !== "string" || x.trim().length === 0 || x.length > max) {
    throw new HttpError(400, `invalid_${key}`, `${key} must be 1..${max} characters`);
  }
  return x.trim();
}

serve(async (req) => {
  const ctx = await authenticate(req);
  const body = await readJsonObject<SupportRequest>(req);
  const { deviceHash } = await deviceFromRequest(req, ctx);

  switch (body.op) {
    case "ticket.create": {
      const subject = text(body.subject, "subject", 200);
      const message = text(body.body, "body", 8000);
      const category = body.category === undefined ? "other" : body.category;
      if (typeof category !== "string" || !(CATEGORIES as readonly string[]).includes(category)) {
        throw new HttpError(400, "invalid_category", `category must be one of ${CATEGORIES.join(", ")}`);
      }
      await enforceRateLimit(ctx.db, `support:${ctx.userId}`, SUPPORT_MESSAGES_PER_HOUR, RATE_WINDOW_SECONDS, 1);
      const ticket = unwrap(
        await ctx.db.from("support_tickets").insert({ user_id: ctx.userId, subject, category }).select("*").single(),
        "ticket_insert",
      ) as { id: string };
      unwrap(
        await ctx.db.from("support_messages").insert({
          ticket_id: ticket.id,
          author: "user",
          author_id: ctx.userId,
          body: message,
        }),
        "message_insert",
      );
      await emitEvent(ctx.db, ctx.userId, deviceHash, "ticket_created", { ticket_id: ticket.id, category });
      await audit(ctx, "ticket.created", ticket.id, { category });
      return json({ ticket });
    }
    case "ticket.reply": {
      if (typeof body.ticket_id !== "string" || !UUID_RE.test(body.ticket_id)) {
        throw new HttpError(400, "invalid_ticket_id");
      }
      const message = text(body.body, "body", 8000);
      await enforceRateLimit(ctx.db, `support:${ctx.userId}`, SUPPORT_MESSAGES_PER_HOUR, RATE_WINDOW_SECONDS, 1);
      const ticket = unwrap(
        await ctx.db.from("support_tickets").select("id, status").eq("id", body.ticket_id).eq("user_id", ctx.userId)
          .maybeSingle(),
        "ticket_lookup",
      ) as { id: string; status: string } | null;
      if (!ticket) throw new HttpError(404, "ticket_not_found");
      if (ticket.status === "closed") {
        // a reply to a closed ticket reopens it (the trigger sets status = open on user messages).
        unwrap(await ctx.db.from("support_tickets").update({ status: "open" }).eq("id", ticket.id), "ticket_reopen");
      }
      const msg = unwrap(
        await ctx.db.from("support_messages").insert({
          ticket_id: ticket.id,
          author: "user",
          author_id: ctx.userId,
          body: message,
        }).select("*").single(),
        "message_insert",
      );
      const fresh = unwrap(
        await ctx.db.from("support_tickets").select("*").eq("id", ticket.id).single(),
        "ticket_reload",
      );
      await audit(ctx, "ticket.replied", ticket.id, {});
      return json({ message: msg, ticket: fresh });
    }
    case "ticket.list": {
      const tickets = unwrap(
        await ctx.db.from("support_tickets").select("*").eq("user_id", ctx.userId).order("updated_at", {
          ascending: false,
        }).limit(100),
        "tickets_list",
      ) as { id: string }[];
      const ids = tickets.map((t) => t.id);
      const messages = ids.length
        ? unwrap(
          await ctx.db.from("support_messages").select("id, ticket_id, author, body, created_at").in("ticket_id", ids)
            .order("created_at", {
              ascending: true,
            }),
          "messages_list",
        ) as { ticket_id: string }[]
        : [];
      const byTicket = new Map<string, unknown[]>();
      for (const m of messages) {
        const list = byTicket.get(m.ticket_id) ?? [];
        list.push(m);
        byTicket.set(m.ticket_id, list);
      }
      return json({ tickets: tickets.map((t) => ({ ...t, messages: byTicket.get(t.id) ?? [] })) });
    }
    default:
      throw new HttpError(400, "invalid_op", "op must be ticket.create | ticket.reply | ticket.list");
  }
});
