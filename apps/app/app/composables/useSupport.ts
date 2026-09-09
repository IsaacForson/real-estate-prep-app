/**
 * "Contact us" tickets (V2 §1, §6.3): the `support` edge function owns `support_tickets` /
 * `support_messages`; the admin answers in the console. Ops: ticket.create, ticket.reply, ticket.list.
 */
import { parseTicket, type SupportTicket } from "~~/lib/state/contracts";
import { callFunction, functionsBase } from "~~/lib/study/api";

export type { SupportTicket };

export function useSupport() {
  const config = useRuntimeConfig();
  const auth = useAuth();
  const events = useEvents();
  const tickets = useState<SupportTicket[]>("support.tickets", () => []);
  const loading = useState<boolean>("support.loading", () => false);
  const error = useState<string | null>("support.error", () => null);

  async function call<T>(op: string, params: Record<string, unknown>): Promise<T | null> {
    error.value = null;
    const headers = await auth.authHeaders();
    if (!headers) { error.value = "Sign in to contact support."; return null; }
    try {
      return await callFunction<T>(functionsBase(config.public.supabaseUrl), "support", { op, ...params }, headers);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  function upsert(t: SupportTicket) {
    const i = tickets.value.findIndex((x) => x.id === t.id);
    if (i >= 0) tickets.value.splice(i, 1, t); else tickets.value.unshift(t);
  }

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const res = await call<{ tickets?: unknown[] } | unknown[]>("ticket.list", {});
      const rows = Array.isArray(res) ? res : Array.isArray(res?.tickets) ? res.tickets : [];
      tickets.value = rows.map(parseTicket).filter((t): t is SupportTicket => !!t).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    } finally {
      loading.value = false;
    }
  }

  async function create(subject: string, body: string, category = "general"): Promise<SupportTicket | null> {
    const res = await call<{ ticket?: unknown } | Record<string, unknown>>("ticket.create", { subject: subject.trim(), body: body.trim(), category });
    if (!res) return null;
    const t = parseTicket((res as { ticket?: unknown }).ticket ?? res);
    if (t) {
      if (!t.messages.length) t.messages.push({ id: "", ticket_id: t.id, author: "user", body: body.trim(), created_at: t.created_at });
      upsert(t);
      events.track("ticket_created", { ticket_id: t.id, category });
    }
    return t;
  }

  async function reply(ticketId: string, body: string): Promise<SupportTicket | null> {
    const res = await call<{ ticket?: unknown } | Record<string, unknown>>("ticket.reply", { ticket_id: ticketId, id: ticketId, body: body.trim() });
    if (!res) return null;
    const t = parseTicket((res as { ticket?: unknown }).ticket ?? res);
    if (t) upsert(t);
    else await load();
    return t ?? tickets.value.find((x) => x.id === ticketId) ?? null;
  }

  const open = computed(() => tickets.value.filter((t) => t.status !== "closed"));

  return { tickets, open, loading, error, load, create, reply };
}
