/**
 * Admin console client (V2_PLAN §6.2). Every privileged read/write goes through the `admin-api`
 * edge function: POST `/functions/v1/admin-api` with `{ op, params }`, the admin's JWT and the anon
 * apikey. Responses are `{ ok: true, data }` or `{ ok: false, error, code }`; failures surface as
 * `AdminError` so pages can show `error`/`code` verbatim.
 *
 * Also exports the access guard (`requireAdmin`), a small query helper that waits for the guard,
 * the confirm-dialog / toast stores rendered by `layouts/admin.vue`, and number/date formatters.
 */
import { functionsBase } from "~~/lib/study/api";

// ───────────────────────────── types (contract §6.2) ─────────────────────────────

export type AdminRange = "7d" | "30d" | "90d" | "all";

export interface AdminKpis {
  signups: number;
  dau: number;
  wau: number;
  mau: number;
  purchases: Array<{ store: string; count: number; revenue_usd: number }>;
  refunds: number;
  active_complete: number;
  active_guarantee: number;
  conversion_pct: number;
  mocks_completed: number;
  answers: number;
  tickets_open: number;
  reviews_pending: number;
  series: Array<{ date: string; signups: number; purchases: number; answers: number }>;
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  is_admin: boolean;
  disabled: boolean;
  entitlements: string[];
  devices: number;
  home_jurisdiction: string | null;
}

export interface AdminEntitlement {
  id?: string;
  product: string;
  source?: string | null;
  granted_at?: string | null;
  revoked_at?: string | null;
  paused_until?: string | null;
  note?: string | null;
}

export interface AdminDevice {
  id: string;
  platform?: string | null;
  name?: string | null;
  device_hash?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
  removed_at?: string | null;
  has_live_session?: boolean;
}

export interface AdminEvent {
  id?: string;
  user_id?: string | null;
  kind: string;
  props?: Record<string, unknown> | null;
  device_hash?: string | null;
  at?: string;
  created_at?: string;
}

export interface AdminTicket {
  id: string;
  user_id?: string | null;
  email?: string | null;
  subject: string;
  category?: string | null;
  status: string;
  created_at: string;
  updated_at?: string | null;
  last_message_at?: string | null;
  messages?: AdminTicketMessage[];
}

export interface AdminTicketMessage {
  id?: string;
  author_id?: string | null;
  from_admin?: boolean;
  is_admin?: boolean;
  role?: string;
  body: string;
  created_at: string;
}

export interface AdminReview {
  id: string;
  user_id?: string | null;
  email?: string | null;
  rating: number;
  body: string | null;
  status: string;
  created_at: string;
}

export interface AdminCoupon {
  id?: string;
  code: string;
  kind: string;
  value: number | null;
  product: string | null;
  max_uses: number | null;
  uses?: number;
  used_count?: number;
  expires_at: string | null;
  note: string | null;
  disabled_at?: string | null;
  disabled?: boolean;
  created_at?: string;
  redeemed_at?: string | null;
}

export interface AdminUserDetail {
  profile: { id: string; home_jurisdiction: string | null; exam_date: string | null; is_admin?: boolean; disabled?: boolean; created_at?: string } | null;
  auth: { email: string | null; created_at: string | null; last_sign_in_at: string | null; banned_until: string | null } | null;
  entitlements: AdminEntitlement[];
  devices: AdminDevice[];
  sessions: Array<Record<string, unknown>>;
  free_tier: { questions_used: number; mocks_used: number } | null;
  study: { answers: number; accuracy: number | null; mocks: number; readiness: number | null } | null;
  events: AdminEvent[];
  tickets: AdminTicket[];
  reviews: AdminReview[];
  coupons: AdminCoupon[];
}

export interface AdminAuditRow {
  id: string;
  admin_id: string;
  admin_email?: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before?: unknown;
  after?: unknown;
  created_at: string;
}

export interface AdminContentAlert {
  id: string;
  item_id?: string | null;
  kind?: string | null;
  message?: string | null;
  detail?: string | null;
  source_url?: string | null;
  status: string;
  created_at: string;
  resolved_at?: string | null;
}

export interface AdminContentVersion {
  id?: string;
  version?: string | number;
  published_at?: string;
  created_at?: string;
  items?: number;
  item_count?: number;
  notes?: string | null;
}

export interface AdminFlaggedDevice {
  device_hash: string;
  platform?: string | null;
  model?: string | null;
  accounts?: number;
  account_count?: number;
  account_ids?: string[];
  blocked: boolean;
  notes?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
}

export type CouponKind = "percent" | "amount" | "gift";

export interface CouponCreateParams {
  kind: CouponKind;
  value: number | null;
  product: string;
  max_uses: number | null;
  expires_at: string | null;
  note: string;
  count: number;
}

// ───────────────────────────── errors ─────────────────────────────

export class AdminError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "AdminError";
    this.code = code;
    this.status = status;
  }
}

export function toAdminError(e: unknown): AdminError {
  if (e instanceof AdminError) return e;
  if (e instanceof TypeError) return new AdminError("network", "Could not reach the admin API. Check your connection and try again.");
  return new AdminError("unknown", e instanceof Error ? e.message : String(e));
}

/** Friendly explanation for the codes the function (or the network) can return. */
export function describeAdminError(e: AdminError): string {
  switch (e.code) {
    case "network": return e.message;
    case "not_configured": return "Supabase is not configured in this build, so the admin console has no backend.";
    case "not_signed_in": return "Your session has expired. Sign in again to continue.";
    case "forbidden":
    case "http_403": return "This account is not an admin.";
    case "http_404": return "The admin-api function is not deployed yet.";
    default: return e.message || e.code;
  }
}

/** Accepts either a bare array or `{ [key]: [...] }` (or the first array-valued field). */
export function asList<T>(data: unknown, key?: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (key && Array.isArray(o[key])) return o[key] as T[];
    for (const v of Object.values(o)) if (Array.isArray(v)) return v as T[];
  }
  return [];
}

function cursorOf(data: unknown): string | null {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    const c = o.next ?? o.cursor ?? o.next_cursor;
    return typeof c === "string" && c ? c : null;
  }
  return null;
}

// ───────────────────────────── access state ─────────────────────────────

export type AdminAccess = "checking" | "ok" | "denied" | "unconfigured";

function waitFor(ref: Ref<boolean>): Promise<void> {
  if (ref.value) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = watch(ref, (v) => { if (v) { stop(); resolve(); } });
  });
}

// ───────────────────────────── composable ─────────────────────────────

export function useAdmin() {
  const auth = useAuth();
  const entitlement = useEntitlement();
  const config = useRuntimeConfig();
  const access = useState<AdminAccess>("admin.access", () => "checking");
  const isAdmin = entitlement.isAdmin;
  const base = auth.configured ? functionsBase(config.public.supabaseUrl) : "";

  /**
   * Waits for auth to initialise, hydrates the profile if needed and redirects non-admins to `/app`.
   * Resolves true only for admins. Client-only (admin routes are ssr:false); a no-op on the server.
   */
  async function requireAdmin(): Promise<boolean> {
    if (!import.meta.client) return false;
    if (access.value === "ok") return true;
    if (!auth.configured) { access.value = "unconfigured"; return false; }
    await auth.init();
    await waitFor(auth.ready);
    const uid = auth.user.value?.id;
    if (!uid) { access.value = "denied"; await navigateTo("/app"); return false; }
    if (!entitlement.profile.value || entitlement.profile.value.id !== uid) await entitlement.load();
    if (!isAdmin.value) { access.value = "denied"; await navigateTo("/app"); return false; }
    access.value = "ok";
    return true;
  }

  async function call<T>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!base) throw new AdminError("not_configured", "Supabase is not configured.");
    const token = await auth.accessToken();
    if (!token) throw new AdminError("not_signed_in", "Not signed in.", 401);
    let res: Response;
    try {
      res = await fetch(`${base}/admin-api`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, apikey: config.public.supabaseAnonKey },
        body: JSON.stringify({ op, params }),
      });
    } catch (e) {
      throw toAdminError(e);
    }
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { /* non-json body */ }
    const body = (parsed ?? {}) as { ok?: boolean; data?: T; error?: unknown; code?: unknown };
    if (!res.ok || body.ok === false) {
      // `{ ok:false, error, code }` per §6.2; fall back to the `{ error: { code, message } }` shape
      // the other functions use, then to the HTTP status.
      let code = typeof body.code === "string" ? body.code : "";
      let message = typeof body.error === "string" ? body.error : "";
      if (body.error && typeof body.error === "object") {
        const err = body.error as { code?: unknown; message?: unknown };
        if (!code && typeof err.code === "string") code = err.code;
        if (!message && typeof err.message === "string") message = err.message;
      }
      if (!code) code = res.status === 403 ? "forbidden" : `http_${res.status}`;
      if (!message) message = res.statusText || code;
      if (res.status === 403) access.value = "denied";
      throw new AdminError(code, message, res.status);
    }
    return (body.data ?? parsed) as T;
  }

  // Typed helpers per op. Mutations resolve with whatever the function returns (usually the new row).
  const api = {
    kpis: (range: AdminRange) => call<AdminKpis>("kpis", { range }),
    users: {
      search: async (q: string, limit = 50, cursor: string | null = null) => {
        const d = await call<unknown>("users.search", { q, limit, cursor });
        return { users: asList<AdminUserRow>(d, "users"), next: cursorOf(d) };
      },
      get: (id: string) => call<AdminUserDetail>("users.get", { id }),
      disable: (id: string, reason: string) => call<unknown>("users.disable", { id, reason }),
      enable: (id: string) => call<unknown>("users.enable", { id }),
      sendCode: (id: string) => call<unknown>("users.sendCode", { id }),
      removeDevice: (id: string, device_id: string) => call<unknown>("users.removeDevice", { id, device_id }),
      setAdmin: (id: string, is_admin: boolean) => call<unknown>("users.setAdmin", { id, is_admin }),
    },
    entitlements: {
      grant: (user_id: string, product: string, note: string) => call<unknown>("entitlements.grant", { user_id, product, note }),
      revoke: (user_id: string, product: string, reason: string) => call<unknown>("entitlements.revoke", { user_id, product, reason }),
      pause: (user_id: string, product: string, until: string) => call<unknown>("entitlements.pause", { user_id, product, until }),
      resume: (user_id: string, product: string) => call<unknown>("entitlements.resume", { user_id, product }),
    },
    coupons: {
      create: async (p: CouponCreateParams) => {
        const d = await call<unknown>("coupons.create", { ...p });
        // accept `["CODE", …]`, `[{code…}]` or `{ codes: [...] }` / `{ coupons: [...] }`
        const list = asList<string | AdminCoupon>(d, "codes");
        return list.map((c) => (typeof c === "string" ? c : c.code));
      },
      list: async () => asList<AdminCoupon>(await call<unknown>("coupons.list", {}), "coupons"),
      disable: (code: string) => call<unknown>("coupons.disable", { code }),
    },
    tickets: {
      list: async (status: string | null, cursor: string | null = null) => {
        const d = await call<unknown>("tickets.list", { status: status ?? undefined, cursor });
        return { tickets: asList<AdminTicket>(d, "tickets"), next: cursorOf(d) };
      },
      get: async (id: string) => {
        const d = await call<unknown>("tickets.get", { id });
        const o = (d ?? {}) as Record<string, unknown>;
        const ticket = ((o.ticket as AdminTicket | undefined) ?? (o.id ? (o as unknown as AdminTicket) : null));
        const messages = asList<AdminTicketMessage>(o.messages ?? o.replies ?? ticket?.messages ?? [], "messages");
        return { ticket, messages };
      },
      reply: (id: string, body: string) => call<unknown>("tickets.reply", { id, body }),
      close: (id: string) => call<unknown>("tickets.close", { id }),
    },
    reviews: {
      list: async (status: string | null) => asList<AdminReview>(await call<unknown>("reviews.list", { status: status ?? undefined }), "reviews"),
      setStatus: (id: string, status: "approved" | "rejected" | "pending") => call<unknown>("reviews.setStatus", { id, status }),
    },
    events: {
      list: async (p: { user_id?: string; kind?: string; since?: string; limit?: number }) =>
        asList<AdminEvent>(await call<unknown>("events.list", { ...p }), "events"),
    },
    audit: {
      list: async (limit = 50, cursor: string | null = null) => {
        const d = await call<unknown>("audit.list", { limit, cursor });
        return { entries: asList<AdminAuditRow>(d, "entries"), next: cursorOf(d) };
      },
    },
    content: {
      alerts: async (status: string | null) => asList<AdminContentAlert>(await call<unknown>("content.alerts", { status: status ?? undefined }), "alerts"),
      resolveAlert: (id: string) => call<unknown>("content.resolveAlert", { id }),
      versions: async () => asList<AdminContentVersion>(await call<unknown>("content.versions", {}), "versions"),
    },
    devices: {
      flagged: async () => asList<AdminFlaggedDevice>(await call<unknown>("devices.flagged", {}), "devices"),
      block: (device_hash: string, blocked: boolean, notes: string) => call<unknown>("devices.block", { device_hash, blocked, notes }),
    },
  };

  return { access, isAdmin, requireAdmin, call, api };
}

// ───────────────────────────── query helper ─────────────────────────────

/**
 * Runs `loader` on the client once the admin guard passes; exposes loading / error / data and a
 * `reload()`. Pages pass a ref-based loader so filters re-run via `watch(filter, q.reload)`.
 */
export function useAdminQuery<T>(loader: () => Promise<T>, opts: { immediate?: boolean } = {}) {
  const { requireAdmin } = useAdmin();
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = ref<AdminError | null>(null);
  const loaded = ref(false);
  let seq = 0;

  async function reload(): Promise<void> {
    const mine = ++seq;
    loading.value = true;
    error.value = null;
    try {
      if (!(await requireAdmin())) return;
      const result = await loader();
      if (mine === seq) { data.value = result; loaded.value = true; }
    } catch (e) {
      if (mine === seq) error.value = toAdminError(e);
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  if (opts.immediate !== false) onMounted(() => { void reload(); });
  return { data, loading, error, loaded, reload };
}

/** Wraps a mutation with busy state + toast + optional refresh. */
export function useAdminAction() {
  const toast = useAdminToast();
  const busy = ref<string | null>(null);
  async function run<T>(key: string, fn: () => Promise<T>, okText: string, after?: () => void | Promise<void>): Promise<T | null> {
    busy.value = key;
    try {
      const r = await fn();
      toast.push("ok", okText);
      if (after) await after();
      return r;
    } catch (e) {
      const err = toAdminError(e);
      toast.push("error", `${describeAdminError(err)} (${err.code})`);
      return null;
    } finally {
      busy.value = null;
    }
  }
  return { busy, run };
}

// ───────────────────────────── confirm dialog + toasts (rendered by layouts/admin.vue) ─────────────────────────────

export interface AdminConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Ask for free text (reason / note); `required` blocks confirm until non-empty. */
  reason?: { label: string; placeholder?: string; required?: boolean; type?: "text" | "date" | "datetime-local" };
}
export interface AdminConfirmResult { ok: boolean; reason: string }
interface PendingConfirm { options: AdminConfirmOptions; resolve: (r: AdminConfirmResult) => void }

export function useAdminConfirm() {
  const pending = useState<PendingConfirm | null>("admin.confirm", () => null);
  function confirm(options: AdminConfirmOptions): Promise<AdminConfirmResult> {
    pending.value?.resolve({ ok: false, reason: "" });
    return new Promise((resolve) => { pending.value = { options, resolve }; });
  }
  function settle(r: AdminConfirmResult) {
    pending.value?.resolve(r);
    pending.value = null;
  }
  return { pending, confirm, settle };
}

export interface AdminToastItem { id: number; kind: "ok" | "error" | "info"; text: string }
let toastSeq = 0;
export function useAdminToast() {
  const items = useState<AdminToastItem[]>("admin.toasts", () => []);
  function push(kind: AdminToastItem["kind"], text: string, ttl = 5000) {
    const id = ++toastSeq;
    items.value = [...items.value, { id, kind, text }];
    if (import.meta.client) setTimeout(() => dismiss(id), ttl);
  }
  function dismiss(id: number) { items.value = items.value.filter((t) => t.id !== id); }
  return { items, push, dismiss };
}

// ───────────────────────────── formatters ─────────────────────────────

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const rel = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export const adminFmt = {
  usd: (n: number | null | undefined) => (n == null || Number.isNaN(n) ? "—" : usd.format(n)),
  int: (n: number | null | undefined) => (n == null || Number.isNaN(n) ? "—" : int.format(n)),
  pct: (n: number | null | undefined, digits = 1) => (n == null || Number.isNaN(n) ? "—" : `${n.toFixed(digits)}%`),
  /** 0–1 ratio → percent */
  ratio: (n: number | null | undefined, digits = 0) => (n == null || Number.isNaN(n) ? "—" : `${(n * 100).toFixed(digits)}%`),
  abs: (s: string | number | null | undefined) => {
    if (!s) return "—";
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  },
  day: (s: string | null | undefined) => {
    if (!s) return "—";
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  },
  relative: (s: string | number | null | undefined, now = Date.now()) => {
    if (!s) return "—";
    const t = new Date(s).getTime();
    if (Number.isNaN(t)) return String(s);
    const diff = (t - now) / 1000;
    const a = Math.abs(diff);
    if (a < 45) return "just now";
    if (a < 3600) return rel.format(Math.round(diff / 60), "minute");
    if (a < 86400) return rel.format(Math.round(diff / 3600), "hour");
    if (a < 86400 * 30) return rel.format(Math.round(diff / 86400), "day");
    if (a < 86400 * 365) return rel.format(Math.round(diff / (86400 * 30)), "month");
    return rel.format(Math.round(diff / (86400 * 365)), "year");
  },
  short: (s: string | null | undefined, n = 8) => (s ? `${s.slice(0, n)}…` : "—"),
};
