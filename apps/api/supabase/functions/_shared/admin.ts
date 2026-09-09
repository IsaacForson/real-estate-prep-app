/**
 * admin-api guard + audit (V2_PLAN §1 "admin console", §6.2). The JWT identifies the caller; the
 * caller's *profile row* (profiles.is_admin) decides. There is no other admin credential, so a stolen
 * service key is the only way around this — and that never reaches a client.
 */
import type { AuthContext } from "./auth.ts";
import { authenticate } from "./auth.ts";
import { type Db, unwrap } from "./db.ts";
import { HttpError } from "./response.ts";

export const ADMIN_OPS = [
  "kpis",
  "users.search",
  "users.get",
  "users.disable",
  "users.enable",
  "users.sendCode",
  "users.removeDevice",
  "users.setAdmin",
  "users.impersonate",
  "users.stopImpersonation",
  "entitlements.grant",
  "entitlements.revoke",
  "entitlements.pause",
  "entitlements.resume",
  "coupons.create",
  "coupons.list",
  "coupons.disable",
  "tickets.list",
  "tickets.get",
  "tickets.reply",
  "tickets.close",
  "reviews.list",
  "reviews.setStatus",
  "events.list",
  "audit.list",
  "content.alerts",
  "content.resolveAlert",
  "content.versions",
  "content.resync",
  "devices.flagged",
  "devices.block",
  "settings.get",
  "settings.set",
  "refunds.list",
  "refunds.create",
  "refunds.decide",
  "refunds.markPaid",
  "refunds.eligibility",
] as const;
export type AdminOp = (typeof ADMIN_OPS)[number];

export function isAdminOp(x: unknown): x is AdminOp {
  return typeof x === "string" && (ADMIN_OPS as readonly string[]).includes(x);
}

export type AdminDecision = { ok: true } | { ok: false; status: 401 | 403; code: string };

/**
 * Pure guard: the profile row of the authenticated user decides. A missing profile or a non-boolean
 * flag is a refusal, never a pass. `authenticated` mirrors "the jwt verified".
 */
export function decideAdminAccess(
  input: { authenticated: boolean; profile: { is_admin?: unknown } | null },
): AdminDecision {
  if (!input.authenticated) return { ok: false, status: 401, code: "missing_token" };
  if (!input.profile) return { ok: false, status: 403, code: "not_admin" };
  if (input.profile.is_admin !== true) return { ok: false, status: 403, code: "not_admin" };
  return { ok: true };
}

export interface AdminContext extends AuthContext {
  adminId: string;
}

/** Authenticate and require profiles.is_admin. 401 / 403 otherwise. */
export async function requireAdmin(req: Request): Promise<AdminContext> {
  const ctx = await authenticate(req);
  const profile = unwrap(
    await ctx.db.from("profiles").select("id, is_admin").eq("id", ctx.userId).maybeSingle(),
    "admin_profile_lookup",
  ) as { id: string; is_admin: boolean } | null;
  const decision = decideAdminAccess({ authenticated: true, profile });
  if (!decision.ok) throw new HttpError(decision.status, decision.code, "this endpoint is for the admin console only");
  return { ...ctx, adminId: ctx.userId };
}

export interface AuditInput {
  op: string;
  targetType: string | null;
  targetId: string | null;
  before?: unknown;
  after?: unknown;
}

/** Every admin-api call writes one row, reads included (V2_PLAN §6.2 "every op writes admin_audit"). */
export async function writeAdminAudit(db: Db, adminId: string, ipHash: string | null, a: AuditInput): Promise<void> {
  const { error } = await db.from("admin_audit").insert({
    admin_id: adminId,
    action: a.op,
    target_type: a.targetType,
    target_id: a.targetId,
    before: a.before === undefined ? null : a.before,
    after: a.after === undefined ? null : a.after,
    ip_hash: ipHash,
  });
  if (error) console.error("admin_audit insert failed", error.message);
}

/** Body helpers for ops: strings, uuids, ints with bounds. Throw 400 on anything else. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function reqUuid(p: Record<string, unknown>, key: string): string {
  const v = p[key];
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(400, `invalid_${key}`, `${key} must be a uuid`);
  return v.toLowerCase();
}
export function optUuid(p: Record<string, unknown>, key: string): string | null {
  if (p[key] === undefined || p[key] === null) return null;
  return reqUuid(p, key);
}
export function reqStr(p: Record<string, unknown>, key: string, max = 4000, min = 1): string {
  const v = p[key];
  if (typeof v !== "string" || v.trim().length < min || v.length > max) {
    throw new HttpError(400, `invalid_${key}`, `${key} must be a string (${min}..${max} chars)`);
  }
  return v.trim();
}
export function optStr(p: Record<string, unknown>, key: string, max = 4000): string | null {
  if (p[key] === undefined || p[key] === null) return null;
  return reqStr(p, key, max, 0);
}
export function optInt(p: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const v = p[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(400, `invalid_${key}`);
  return Math.min(max, Math.max(min, v));
}
export function optEnum<T extends string>(p: Record<string, unknown>, key: string, allowed: readonly T[]): T | null {
  const v = p[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new HttpError(400, `invalid_${key}`, `${key} must be one of ${allowed.join(", ")}`);
  }
  return v as T;
}
export function reqEnum<T extends string>(p: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const v = optEnum(p, key, allowed);
  if (v === null) throw new HttpError(400, `invalid_${key}`, `${key} must be one of ${allowed.join(", ")}`);
  return v;
}
export function reqProduct(p: Record<string, unknown>, key = "product"): "complete" | "pass_guarantee" {
  return reqEnum(p, key, ["complete", "pass_guarantee"] as const);
}
