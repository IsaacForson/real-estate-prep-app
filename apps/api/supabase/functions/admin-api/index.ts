/**
 * POST /functions/v1/admin-api — the admin console's only backend (V2_PLAN §1, §6.2).
 *
 * headers: Authorization: Bearer <jwt of a profiles.is_admin user>   (403 otherwise)
 * body:    { op, params }
 * returns: { ok: true, data } | { ok: false, error, code }
 *
 * every op — reads included — writes one admin_audit row (admin_id, action = op, target, before, after).
 * privileged reads/writes run with the service role; the caller's admin flag is checked from *their
 * profile row*, never from a client-supplied claim.
 */
import {
  type AdminContext,
  isAdminOp,
  optEnum,
  optInt,
  optStr,
  optUuid,
  reqEnum,
  reqProduct,
  reqStr,
  requireAdmin,
  reqUuid,
  writeAdminAudit,
} from "../_shared/admin.ts";
import { generateCouponCodes, validateCouponCreate } from "../_shared/coupons.ts";
import { type Db, rpc, unwrap } from "../_shared/db.ts";
import { emitEvent } from "../_shared/events.ts";
import { isKpiRange, shapeKpis } from "../_shared/kpis.ts";
import { MAX_ACTIVE_DEVICES_CEILING } from "../_shared/limits.ts";
import { errorResponse, HttpError, json, readJsonObject, serve } from "../_shared/response.ts";

type Params = Record<string, unknown>;
interface OpResult {
  data: unknown;
  targetType: string | null;
  targetId: string | null;
  before?: unknown;
  after?: unknown;
}

const BAN_FOREVER = "876000h"; // ~100 years; gotrue's "permanent" idiom
const DEVICE_HASH_RE = /^[0-9a-f]{64}$/;

/** Keys an admin may write. An allowlist, so a typo creates a 400 rather than a dead setting row. */
const SETTING_KEYS = ["device_policy", "content_sync", "guarantee", "announcement"] as const;
const ANNOUNCEMENT_TONES = ["info", "warn", "danger"] as const;
const REFUND_KINDS = ["full", "partial", "guarantee"] as const;
const REFUND_STATUSES = ["open", "approved", "denied", "paid"] as const;
const REFUND_STORES = ["app_store", "play", "paddle", "lemonsqueezy", "coupon", "manual"] as const;
const PRODUCTS = ["complete", "pass_guarantee"] as const;

interface SettingRow {
  key: string;
  value: unknown;
}

/** `products` arrives as an array of product ids; anything else is a 400. */
function readProducts(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, "invalid_products", "products must be an array");
  for (const x of v) {
    if (typeof x !== "string" || !(PRODUCTS as readonly string[]).includes(x)) {
      throw new HttpError(400, "invalid_products", `products must be a subset of ${PRODUCTS.join(", ")}`);
    }
  }
  return [...new Set(v as string[])];
}

async function emailsFor(db: Db, ids: string[]): Promise<Map<string, string | null>> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return new Map();
  const rows = await rpc<{ id: string; email: string | null }[]>(db, "fn_admin_emails", { p_ids: uniq });
  return new Map(rows.map((r) => [r.id, r.email]));
}

async function authUser(db: Db, id: string) {
  const { data, error } = await db.auth.admin.getUserById(id);
  if (error || !data.user) return null;
  const u = data.user as unknown as Record<string, unknown>;
  return {
    email: (u.email as string | undefined) ?? null,
    created_at: (u.created_at as string | undefined) ?? null,
    last_sign_in_at: (u.last_sign_in_at as string | undefined) ?? null,
    banned_until: (u.banned_until as string | undefined) ?? null,
  };
}

async function run(ctx: AdminContext, op: string, p: Params): Promise<OpResult> {
  const db = ctx.db;
  switch (op) {
    // ---- kpis -----------------------------------------------------------------------------
    case "kpis": {
      const range = p.range === undefined ? "30d" : p.range;
      if (!isKpiRange(range)) throw new HttpError(400, "invalid_range", "range must be 7d | 30d | 90d | all");
      const raw = await rpc<unknown>(db, "fn_admin_kpis", { p_range: range });
      return { data: shapeKpis(raw, range), targetType: "kpis", targetId: range };
    }

    // ---- users ----------------------------------------------------------------------------
    case "users.search": {
      const q = optStr(p, "q", 200);
      const limit = optInt(p, "limit", 50, 1, 200);
      const offset = typeof p.cursor === "string" && /^\d+$/.test(p.cursor) ? Number.parseInt(p.cursor, 10) : 0;
      const rows = await rpc<Record<string, unknown>[]>(db, "fn_admin_search_users", {
        p_q: q,
        p_limit: limit,
        p_offset: offset,
      });
      const total = rows.length ? Number(rows[0]!.total ?? 0) : 0;
      const users = rows.map((r) => ({
        id: r.id,
        email: r.email,
        created_at: r.created_at,
        last_sign_in_at: r.last_sign_in_at,
        is_admin: r.is_admin === true,
        disabled: typeof r.banned_until === "string" && Date.parse(r.banned_until) > Date.now(),
        entitlements: r.entitlements ?? [],
        devices: Number(r.devices ?? 0),
        home_jurisdiction: r.home_jurisdiction ?? null,
      }));
      const next = offset + users.length < total ? String(offset + users.length) : null;
      return { data: { users, next, total }, targetType: "query", targetId: q };
    }
    case "users.get": {
      const id = reqUuid(p, "id");
      const [detail, auth] = await Promise.all([
        rpc<Record<string, unknown> | null>(db, "fn_admin_user", { p_user_id: id }),
        authUser(db, id),
      ]);
      if (!detail || detail.profile === null) throw new HttpError(404, "user_not_found");
      return { data: { id, auth, ...detail }, targetType: "user", targetId: id };
    }
    case "users.disable": {
      const id = reqUuid(p, "id");
      const reason = optStr(p, "reason", 500);
      if (id === ctx.adminId) throw new HttpError(400, "cannot_disable_self");
      const before = await authUser(db, id);
      if (!before) throw new HttpError(404, "user_not_found");
      const { error } = await db.auth.admin.updateUserById(id, { ban_duration: BAN_FOREVER });
      if (error) throw new HttpError(502, "auth_admin_failed", error.message);
      // our app-level sessions too, so the next call from any device gets 401 session_revoked.
      await db.from("sessions").update({ revoked_at: new Date().toISOString(), revoke_reason: "admin_disabled" }).eq(
        "user_id",
        id,
      ).is("revoked_at", null);
      await db.from("profiles").update({ current_session_id: null }).eq("id", id);
      const after = await authUser(db, id);
      return {
        data: { id, disabled: true, auth: after },
        targetType: "user",
        targetId: id,
        before,
        after: { ...after, reason },
      };
    }
    /**
     * Open the learner app as this user, to reproduce what they are seeing.
     *
     * Three things make this safe enough to exist:
     *   - it is refused for admins and for yourself, so it cannot be used to escalate;
     *   - it does NOT call register-device. fn_start_shadow_session attaches to the user's existing
     *     device (or mints a slot-less shadow one if they have never opened the app), so
     *     impersonating somebody does not sign them out of their own phone — which, under the
     *     single-device rule, is exactly what a naive implementation would do;
     *   - the shadow session expires on its own, so a forgotten tab is not a standing key;
     *   - the magic-link token is single-use and short-lived, and the whole thing is in admin_audit.
     *
     * It is still a real session as that user. Everything done while impersonating is attributed
     * to them, so it is for looking, not for acting on their behalf.
     */
    case "users.impersonate": {
      const id = reqUuid(p, "id");
      if (id === ctx.adminId) throw new HttpError(400, "cannot_impersonate_self");

      const target = unwrap(
        await db.from("profiles").select("id, is_admin").eq("id", id).maybeSingle(),
        "impersonate_profile_lookup",
      ) as { id: string; is_admin: boolean } | null;
      if (!target) throw new HttpError(404, "user_not_found");
      if (target.is_admin) throw new HttpError(403, "cannot_impersonate_admin", "admins cannot be impersonated");

      const auth = await authUser(db, id);
      if (!auth?.email) throw new HttpError(400, "user_has_no_email", "impersonation needs an email to mint a link");
      if (auth.banned_until && Date.parse(auth.banned_until) > Date.now()) {
        throw new HttpError(400, "user_disabled", "enable the account before opening it");
      }

      const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: "magiclink", email: auth.email });
      if (linkError || !link?.properties?.hashed_token) {
        throw new HttpError(502, "impersonate_link_failed", linkError?.message ?? "no token returned");
      }

      // a session bound to a device the user already has, created without displacing anything
      const shadow = await rpc<{ device_id: string; session_id: string; minted_device: boolean; expires_at: string }[]>(
        db,
        "fn_start_shadow_session",
        { p_user_id: id },
      );
      const s = shadow[0];
      if (!s) throw new HttpError(502, "impersonate_no_session", "could not open a session for this user");

      return {
        data: {
          user_id: id,
          email: auth.email,
          token_hash: link.properties.hashed_token,
          device_id: s.device_id,
          session_id: s.session_id,
          expires_at: s.expires_at,
        },
        targetType: "user",
        targetId: id,
        // never audit the token itself
        after: { impersonated: true, session_id: s.session_id, device_id: s.device_id, minted_device: s.minted_device },
      };
    }
    /** Stop impersonating: revoke the shadow session server-side, not just in the admin's tab. */
    case "users.stopImpersonation": {
      const id = reqUuid(p, "id");
      const ended = await rpc<number>(db, "fn_end_shadow_session", { p_user_id: id });
      return { data: { ended }, targetType: "user", targetId: id, after: { impersonated: false } };
    }
    case "users.enable": {
      const id = reqUuid(p, "id");
      const before = await authUser(db, id);
      if (!before) throw new HttpError(404, "user_not_found");
      const { error } = await db.auth.admin.updateUserById(id, { ban_duration: "none" });
      if (error) throw new HttpError(502, "auth_admin_failed", error.message);
      const after = await authUser(db, id);
      return { data: { id, disabled: false, auth: after }, targetType: "user", targetId: id, before, after };
    }
    case "users.sendCode": {
      const id = reqUuid(p, "id");
      const u = await authUser(db, id);
      if (!u?.email) throw new HttpError(404, "user_not_found");
      const { error } = await db.auth.signInWithOtp({ email: u.email, options: { shouldCreateUser: false } });
      if (error) throw new HttpError(502, "otp_send_failed", error.message);
      return { data: { id, sent_to: u.email }, targetType: "user", targetId: id, after: { otp_sent: true } };
    }
    case "users.removeDevice": {
      const id = reqUuid(p, "id");
      const deviceId = reqUuid(p, "device_id");
      const before = unwrap(
        await db.from("devices").select("*").eq("id", deviceId).eq("user_id", id).maybeSingle(),
        "device_lookup",
      );
      if (!before) throw new HttpError(404, "device_not_found");
      // since 0015 the slot frees at once: this signs the device out, it can register again freely
      const removedAt = await rpc<string>(db, "fn_remove_device", { p_user_id: id, p_device_id: deviceId });
      return {
        data: { id, device_id: deviceId, removed_at: removedAt },
        targetType: "device",
        targetId: deviceId,
        before,
        after: { removed: true, removed_at: removedAt },
      };
    }
    case "users.setAdmin": {
      const id = reqUuid(p, "id");
      if (typeof p.is_admin !== "boolean") throw new HttpError(400, "invalid_is_admin");
      if (id === ctx.adminId && p.is_admin === false) throw new HttpError(400, "cannot_demote_self");
      const before = unwrap(
        await db.from("profiles").select("id, is_admin").eq("id", id).maybeSingle(),
        "profile_lookup",
      );
      if (!before) throw new HttpError(404, "user_not_found");
      const after = unwrap(
        await db.from("profiles").update({ is_admin: p.is_admin }).eq("id", id).select("id, is_admin").single(),
        "profile_update",
      );
      return { data: after, targetType: "user", targetId: id, before, after };
    }

    // ---- entitlements ---------------------------------------------------------------------
    case "entitlements.grant": {
      const userId = reqUuid(p, "user_id");
      const product = reqProduct(p);
      const note = optStr(p, "note", 500);
      const before = unwrap(
        await db.from("entitlements").select("*").eq("user_id", userId).eq("product", product).is("revoked_at", null),
        "ent_lookup",
      );
      const entId = await rpc<string>(db, "fn_grant_entitlement", {
        p_user_id: userId,
        p_product: product,
        p_source: "manual",
        p_external_id: `manual:${userId}:${product}`,
        p_external_customer_id: null,
        p_meta: { note, admin_id: ctx.adminId, granted_via: "admin-api" },
      });
      const after = unwrap(await db.from("entitlements").select("*").eq("id", entId).single(), "ent_reload");
      return { data: after, targetType: "entitlement", targetId: entId, before, after };
    }
    case "entitlements.revoke": {
      const userId = reqUuid(p, "user_id");
      const product = reqProduct(p);
      const reason = optStr(p, "reason", 500) ?? "support";
      const before = unwrap(
        await db.from("entitlements").select("*").eq("user_id", userId).eq("product", product).is("revoked_at", null),
        "ent_lookup",
      );
      const n = await rpc<number>(db, "fn_revoke_entitlement_by_user", {
        p_user_id: userId,
        p_product: product,
        p_reason: reason,
      });
      return {
        data: { user_id: userId, product, revoked: n },
        targetType: "user",
        targetId: userId,
        before,
        after: { revoked: n, reason },
      };
    }
    case "entitlements.pause": {
      const userId = reqUuid(p, "user_id");
      const product = reqProduct(p);
      const until = reqStr(p, "until", 40);
      if (!Number.isFinite(Date.parse(until))) throw new HttpError(400, "invalid_until");
      const before = unwrap(
        await db.from("entitlements").select("id, paused_until").eq("user_id", userId).eq("product", product).is(
          "revoked_at",
          null,
        ),
        "ent_lookup",
      );
      const n = await rpc<number>(db, "fn_pause_entitlement", {
        p_user_id: userId,
        p_product: product,
        p_until: new Date(until).toISOString(),
      });
      return {
        data: { user_id: userId, product, paused: n, until },
        targetType: "user",
        targetId: userId,
        before,
        after: { paused_until: until },
      };
    }
    case "entitlements.resume": {
      const userId = reqUuid(p, "user_id");
      const product = reqProduct(p);
      const before = unwrap(
        await db.from("entitlements").select("id, paused_until").eq("user_id", userId).eq("product", product).is(
          "revoked_at",
          null,
        ),
        "ent_lookup",
      );
      const n = await rpc<number>(db, "fn_pause_entitlement", { p_user_id: userId, p_product: product, p_until: null });
      return {
        data: { user_id: userId, product, resumed: n },
        targetType: "user",
        targetId: userId,
        before,
        after: { paused_until: null },
      };
    }

    // ---- coupons --------------------------------------------------------------------------
    case "coupons.create": {
      const v = validateCouponCreate(p);
      if (!v.ok) throw new HttpError(400, v.error);
      const existing = unwrap(await db.from("coupons").select("code"), "coupons_codes") as { code: string }[];
      const codes = generateCouponCodes(v.value.count, existing.map((c) => c.code));
      const rows = codes.map((code) => ({
        code,
        kind: v.value.kind,
        value: v.value.value,
        product: v.value.product,
        max_uses: v.value.max_uses,
        expires_at: v.value.expires_at,
        note: v.value.note,
        created_by: ctx.adminId,
      }));
      const inserted = unwrap(await db.from("coupons").insert(rows).select("*"), "coupons_insert");
      return {
        data: { coupons: inserted, codes },
        targetType: "coupon",
        targetId: codes.length === 1 ? codes[0]! : `${codes.length} codes`,
        after: { ...v.value, codes },
      };
    }
    case "coupons.list": {
      const coupons = unwrap(
        await db.from("coupons").select("*").order("created_at", { ascending: false }).limit(500),
        "coupons_list",
      );
      return { data: { coupons }, targetType: "coupon", targetId: null };
    }
    case "coupons.disable": {
      const code = reqStr(p, "code", 14).toUpperCase();
      const before = unwrap(await db.from("coupons").select("*").eq("code", code).maybeSingle(), "coupon_lookup");
      if (!before) throw new HttpError(404, "coupon_not_found");
      const after = unwrap(
        await db.from("coupons").update({ disabled_at: new Date().toISOString() }).eq("code", code).select("*")
          .single(),
        "coupon_disable",
      );
      return { data: after, targetType: "coupon", targetId: code, before, after };
    }

    // ---- tickets --------------------------------------------------------------------------
    case "tickets.list": {
      const status = optEnum(p, "status", ["open", "answered", "closed"] as const);
      const limit = optInt(p, "limit", 50, 1, 200);
      const cursor = optStr(p, "cursor", 40);
      let q = db.from("support_tickets").select("*").order("updated_at", { ascending: false }).limit(limit);
      if (status) q = q.eq("status", status);
      if (cursor && Number.isFinite(Date.parse(cursor))) q = q.lt("updated_at", cursor);
      const tickets = unwrap(await q, "tickets_list") as { id: string; user_id: string; updated_at: string }[];
      const emails = await emailsFor(db, tickets.map((t) => t.user_id));
      const ids = tickets.map((t) => t.id);
      const msgs = ids.length
        ? unwrap(
          await db.from("support_messages").select("ticket_id, author, body, created_at").in("ticket_id", ids).order(
            "created_at",
            { ascending: false },
          ),
          "messages_list",
        ) as { ticket_id: string; author: string; body: string; created_at: string }[]
        : [];
      const last = new Map<string, { author: string; body: string; created_at: string }>();
      const counts = new Map<string, number>();
      for (const m of msgs) {
        if (!last.has(m.ticket_id)) {
          last.set(m.ticket_id, { author: m.author, body: m.body.slice(0, 200), created_at: m.created_at });
        }
        counts.set(m.ticket_id, (counts.get(m.ticket_id) ?? 0) + 1);
      }
      const data = tickets.map((t) => ({
        ...t,
        email: emails.get(t.user_id) ?? null,
        last_message: last.get(t.id) ?? null,
        messages: counts.get(t.id) ?? 0,
      }));
      return {
        data: { tickets: data, next: tickets.length === limit ? tickets[tickets.length - 1]!.updated_at : null },
        targetType: "query",
        targetId: status,
      };
    }
    case "tickets.get": {
      const id = reqUuid(p, "id");
      const ticket = unwrap(await db.from("support_tickets").select("*").eq("id", id).maybeSingle(), "ticket_lookup") as
        | { user_id: string }
        | null;
      if (!ticket) throw new HttpError(404, "ticket_not_found");
      const [messages, emails] = await Promise.all([
        unwrap(
          await db.from("support_messages").select("*").eq("ticket_id", id).order("created_at", { ascending: true }),
          "messages_list",
        ),
        emailsFor(db, [ticket.user_id]),
      ]);
      return {
        data: { ticket: { ...ticket, email: emails.get(ticket.user_id) ?? null }, messages },
        targetType: "ticket",
        targetId: id,
      };
    }
    case "tickets.reply": {
      const id = reqUuid(p, "id");
      const body = reqStr(p, "body", 8000);
      const ticket = unwrap(
        await db.from("support_tickets").select("id, user_id, status, subject").eq("id", id).maybeSingle(),
        "ticket_lookup",
      ) as
        | { id: string; user_id: string; status: string; subject: string }
        | null;
      if (!ticket) throw new HttpError(404, "ticket_not_found");
      const message = unwrap(
        await db.from("support_messages").insert({ ticket_id: id, author: "admin", author_id: ctx.adminId, body })
          .select("*").single(),
        "message_insert",
      );
      // notify the learner (email_outbox is drained by the mail worker; BREVO_API_KEY optional).
      await db.from("email_outbox").insert({
        user_id: ticket.user_id,
        template: "ticket_reply",
        payload: { ticket_id: id, subject: ticket.subject, preview: body.slice(0, 200) },
      });
      await emitEvent(db, ticket.user_id, null, "ticket_reply", { ticket_id: id });
      const after = unwrap(await db.from("support_tickets").select("*").eq("id", id).single(), "ticket_reload") as {
        status: string;
      };
      return {
        data: { message, ticket: after },
        targetType: "ticket",
        targetId: id,
        before: { status: ticket.status },
        after: { status: after.status },
      };
    }
    case "tickets.close": {
      const id = reqUuid(p, "id");
      const before = unwrap(await db.from("support_tickets").select("*").eq("id", id).maybeSingle(), "ticket_lookup");
      if (!before) throw new HttpError(404, "ticket_not_found");
      const after = unwrap(
        await db.from("support_tickets").update({ status: "closed" }).eq("id", id).select("*").single(),
        "ticket_close",
      );
      return { data: after, targetType: "ticket", targetId: id, before, after };
    }

    // ---- reviews --------------------------------------------------------------------------
    case "reviews.list": {
      const status = optEnum(p, "status", ["pending", "approved", "rejected"] as const);
      let q = db.from("reviews").select("*").order("created_at", { ascending: false }).limit(500);
      if (status) q = q.eq("status", status);
      const reviews = unwrap(await q, "reviews_list") as { user_id: string }[];
      const emails = await emailsFor(db, reviews.map((r) => r.user_id));
      return {
        data: { reviews: reviews.map((r) => ({ ...r, email: emails.get(r.user_id) ?? null })) },
        targetType: "query",
        targetId: status,
      };
    }
    case "reviews.setStatus": {
      const id = reqUuid(p, "id");
      const status = reqEnum(p, "status", ["pending", "approved", "rejected"] as const);
      const before = unwrap(await db.from("reviews").select("*").eq("id", id).maybeSingle(), "review_lookup");
      if (!before) throw new HttpError(404, "review_not_found");
      const after = unwrap(
        await db.from("reviews").update({ status }).eq("id", id).select("*").single(),
        "review_update",
      );
      return { data: after, targetType: "review", targetId: id, before, after };
    }

    // ---- events / audit -------------------------------------------------------------------
    case "events.list": {
      const userId = optUuid(p, "user_id");
      const kind = optStr(p, "kind", 64);
      const since = optStr(p, "since", 40);
      const limit = optInt(p, "limit", 200, 1, 1000);
      let q = db.from("events").select("*").order("created_at", { ascending: false }).limit(limit);
      if (userId) q = q.eq("user_id", userId);
      // `kind` may be exact ("purchase_succeeded") or a prefix wildcard ("purchase_*") for the sales view.
      if (kind) q = kind.endsWith("*") ? q.like("kind", `${kind.slice(0, -1).replace(/[%_]/g, "\\$&")}%`) : q.eq("kind", kind);
      if (since && Number.isFinite(Date.parse(since))) q = q.gte("created_at", since);
      const events = unwrap(await q, "events_list");
      return { data: { events }, targetType: "query", targetId: userId ?? kind };
    }
    case "audit.list": {
      const limit = optInt(p, "limit", 100, 1, 500);
      const cursor = optStr(p, "cursor", 40);
      let q = db.from("admin_audit").select("*").order("created_at", { ascending: false }).limit(limit);
      if (cursor && Number.isFinite(Date.parse(cursor))) q = q.lt("created_at", cursor);
      const audit = unwrap(await q, "audit_list") as { created_at: string }[];
      return {
        data: { audit, next: audit.length === limit ? audit[audit.length - 1]!.created_at : null },
        targetType: "query",
        targetId: null,
      };
    }

    // ---- content --------------------------------------------------------------------------
    case "content.alerts": {
      const status = optEnum(p, "status", ["open", "resolved"] as const);
      let q = db.from("content_alerts").select("*").order("created_at", { ascending: false }).limit(500);
      if (status) q = q.eq("status", status);
      return { data: { alerts: unwrap(await q, "alerts_list") }, targetType: "query", targetId: status };
    }
    case "content.resolveAlert": {
      const id = reqUuid(p, "id");
      const before = unwrap(await db.from("content_alerts").select("*").eq("id", id).maybeSingle(), "alert_lookup");
      if (!before) throw new HttpError(404, "alert_not_found");
      const after = unwrap(
        await db.from("content_alerts").update({
          status: "resolved",
          resolved_by: ctx.adminId,
          resolved_at: new Date().toISOString(),
        }).eq("id", id).select("*").single(),
        "alert_resolve",
      );
      return { data: after, targetType: "alert", targetId: id, before, after };
    }
    case "content.versions": {
      const versions = unwrap(
        await db.from("content_versions").select("*").order("published_at", { ascending: false }).limit(50),
        "versions_list",
      );
      return { data: { versions }, targetType: "query", targetId: null };
    }
    case "content.summary": {
      // per bank: published items (item_index), items held in item_content, active mock forms, last publish
      const banks = await rpc<unknown[]>(db, "fn_admin_content_summary", {});
      return { data: { banks }, targetType: "query", targetId: null };
    }

    // ---- devices --------------------------------------------------------------------------
    case "devices.flagged": {
      const limit = optInt(p, "limit", 200, 1, 1000);
      const devices = await rpc<unknown[]>(db, "fn_admin_flagged_devices", { p_limit: limit });
      return { data: { devices }, targetType: "query", targetId: null };
    }
    case "devices.block": {
      const hash = reqStr(p, "device_hash", 64).toLowerCase();
      if (!DEVICE_HASH_RE.test(hash)) throw new HttpError(400, "invalid_device_hash");
      if (typeof p.blocked !== "boolean") throw new HttpError(400, "invalid_blocked");
      const notes = optStr(p, "notes", 1000);
      const before = unwrap(
        await db.from("device_fingerprints").select("*").eq("device_hash", hash).maybeSingle(),
        "device_lookup",
      );
      if (!before) throw new HttpError(404, "device_not_found");
      const patch: Record<string, unknown> = { blocked: p.blocked };
      if (notes !== null) patch.notes = notes;
      const after = unwrap(
        await db.from("device_fingerprints").update(patch).eq("device_hash", hash).select("*").single(),
        "device_update",
      );
      return { data: after, targetType: "device", targetId: hash, before, after };
    }
    case "content.resync": {
      // bump the epoch every install compares against on boot; stale item caches are dropped.
      const after = await rpc<Record<string, unknown>>(db, "fn_bump_content_epoch", {});
      return { data: after, targetType: "content", targetId: "epoch", after };
    }

    // ---- settings -------------------------------------------------------------------------
    case "settings.get": {
      const rows = unwrap(await db.from("app_settings").select("*").order("key"), "settings_list") as SettingRow[];
      const settings: Record<string, unknown> = {};
      for (const r of rows) settings[r.key] = r.value;
      return {
        data: {
          settings,
          rows,
          // resolved values, so the console shows what is in force rather than what was written
          effective: {
            max_active_devices: await rpc<number>(db, "fn_max_active_devices", {}),
            guarantee_window_days: await rpc<number>(db, "fn_guarantee_window_days", {}),
            guarantee_mocks_required: await rpc<number>(db, "fn_guarantee_mocks_required", {}),
          },
        },
        targetType: "settings",
        targetId: null,
      };
    }
    case "settings.set": {
      const key = reqEnum(p, "key", SETTING_KEYS);
      const value = p.value;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new HttpError(400, "invalid_value", "value must be a json object");
      }
      // The device ceiling is the one setting that can lock people out, so it is validated here as
      // well as clamped in SQL — a typo should be a 400, not a silently different rule.
      const v = value as Record<string, unknown>;
      if (key === "device_policy") {
        const n = v.max_active_devices;
        if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_ACTIVE_DEVICES_CEILING) {
          throw new HttpError(400, "invalid_max_active_devices", `max_active_devices must be an integer 1..${MAX_ACTIVE_DEVICES_CEILING}`);
        }
      }
      // These decide whether a real refund claim succeeds, so a typo must be a 400 rather than a
      // quietly different policy that only shows up when someone is denied.
      if (key === "guarantee") {
        const days = v.window_days;
        const mocks = v.mocks_required;
        if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 730) {
          throw new HttpError(400, "invalid_window_days", "window_days must be an integer 1..730");
        }
        if (typeof mocks !== "number" || !Number.isInteger(mocks) || mocks < 0 || mocks > 50) {
          throw new HttpError(400, "invalid_mocks_required", "mocks_required must be an integer 0..50");
        }
      }
      if (key === "announcement") {
        const active = v.active;
        const message = v.message;
        if (typeof active !== "boolean") throw new HttpError(400, "invalid_announcement", "active must be a boolean");
        if (message !== null && (typeof message !== "string" || message.length > 500)) {
          throw new HttpError(400, "invalid_announcement", "message must be a string of at most 500 characters, or null");
        }
        // publishing an empty banner would show learners a blank bar with a dismiss button
        if (active && !(typeof message === "string" && message.trim().length > 0)) {
          throw new HttpError(400, "invalid_announcement", "an active announcement needs a message");
        }
        if (v.tone !== undefined && !(ANNOUNCEMENT_TONES as readonly unknown[]).includes(v.tone)) {
          throw new HttpError(400, "invalid_announcement", `tone must be one of ${ANNOUNCEMENT_TONES.join(", ")}`);
        }
        // stamped server-side so clients can tell a re-publish from an edit and re-show the banner
        v.updated_at = new Date().toISOString();
      }
      const before = unwrap(await db.from("app_settings").select("*").eq("key", key).maybeSingle(), "setting_lookup");
      const after = await rpc<Record<string, unknown>>(db, "fn_set_app_setting", { p_key: key, p_value: value });
      return { data: after, targetType: "setting", targetId: key, before, after };
    }

    // ---- refunds --------------------------------------------------------------------------
    case "refunds.list": {
      const status = optEnum(p, "status", REFUND_STATUSES);
      const limit = optInt(p, "limit", 100, 1, 500);
      const [refunds, totals] = await Promise.all([
        rpc<unknown[]>(db, "fn_admin_refunds", { p_status: status, p_limit: limit }),
        rpc<Record<string, unknown>>(db, "fn_admin_refund_totals", {}),
      ]);
      return { data: { refunds, totals }, targetType: "query", targetId: status };
    }
    case "refunds.eligibility": {
      const userId = reqUuid(p, "user_id");
      const data = await rpc<Record<string, unknown>>(db, "fn_guarantee_eligibility", { p_user_id: userId });
      return { data, targetType: "user", targetId: userId };
    }
    case "refunds.create": {
      const userId = reqUuid(p, "user_id");
      const kind = reqEnum(p, "kind", REFUND_KINDS);
      const products = readProducts(p.products);
      const amount = p.amount_cents === undefined || p.amount_cents === null ? null : optInt(p, "amount_cents", 0, 0, 100_000_00);
      const store = optEnum(p, "store", REFUND_STORES);
      const reason = optStr(p, "reason", 2000);
      const evidence = p.evidence !== null && typeof p.evidence === "object" && !Array.isArray(p.evidence) ? p.evidence : {};
      const after = await rpc<Record<string, unknown>>(db, "fn_admin_refund_create", {
        p_user_id: userId,
        p_kind: kind,
        p_products: products,
        p_amount_cents: amount,
        p_store: store,
        p_reason: reason,
        p_evidence: evidence,
      });
      return { data: after, targetType: "refund", targetId: String(after.id ?? ""), after };
    }
    case "refunds.decide": {
      const id = reqUuid(p, "id");
      if (typeof p.approve !== "boolean") throw new HttpError(400, "invalid_approve");
      const note = optStr(p, "note", 2000);
      const amount = p.amount_cents === undefined || p.amount_cents === null ? null : optInt(p, "amount_cents", 0, 0, 100_000_00);
      const before = unwrap(await db.from("refund_requests").select("*").eq("id", id).maybeSingle(), "refund_lookup");
      if (!before) throw new HttpError(404, "refund_not_found");
      const after = await rpc<Record<string, unknown>>(db, "fn_admin_refund_decide", {
        p_id: id,
        p_approve: p.approve,
        p_note: note,
        p_amount_cents: amount,
      });
      return { data: after, targetType: "refund", targetId: id, before, after };
    }
    case "refunds.markPaid": {
      const id = reqUuid(p, "id");
      const ref = reqStr(p, "external_refund_id", 200);
      const before = unwrap(await db.from("refund_requests").select("*").eq("id", id).maybeSingle(), "refund_lookup");
      if (!before) throw new HttpError(404, "refund_not_found");
      const after = await rpc<Record<string, unknown>>(db, "fn_admin_refund_mark_paid", {
        p_id: id,
        p_external_refund_id: ref,
      });
      return { data: after, targetType: "refund", targetId: id, before, after };
    }

    default:
      throw new HttpError(400, "unknown_op", `unknown op ${op}`);
  }
}

serve(async (req) => {
  try {
    const ctx = await requireAdmin(req);
    const body = await readJsonObject<{ op?: unknown; params?: unknown }>(req);
    if (!isAdminOp(body.op)) throw new HttpError(400, "unknown_op", "unsupported op");
    const params = body.params !== null && typeof body.params === "object" && !Array.isArray(body.params)
      ? (body.params as Params)
      : {};
    let result: OpResult;
    try {
      result = await run(ctx, body.op, params);
    } catch (e) {
      // a failed op is still audited (what was attempted, and why it failed).
      const code = e instanceof HttpError ? e.code : "internal_error";
      await writeAdminAudit(ctx.db, ctx.adminId, ctx.ipHash, {
        op: body.op,
        targetType: "error",
        targetId: code,
        before: params,
        after: null,
      });
      throw e;
    }
    await writeAdminAudit(ctx.db, ctx.adminId, ctx.ipHash, {
      op: body.op,
      targetType: result.targetType,
      targetId: result.targetId,
      before: result.before ?? null,
      after: result.after ?? null,
    });
    return json({ ok: true, data: result.data });
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ ok: false, error: e.message, code: e.code, ...(e.extra ?? {}) }, e.status);
    }
    console.error("admin-api unhandled", e);
    return errorResponse(500, "internal_error", "unexpected error");
  }
});
