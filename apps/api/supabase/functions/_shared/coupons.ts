/**
 * Coupon codes (V2_PLAN §1): admin-generated, `XXXX-XXXX-XXXX` over an alphabet without look-alike
 * characters (no 0/O, 1/I/L). Pure; the redemption rule itself lives in sql (fn_redeem_coupon).
 */

export const COUPON_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars, no 0 O 1 I L
export const COUPON_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
export const COUPON_KINDS = ["percent", "amount", "gift"] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];
export const COUPON_MAX_BATCH = 200;

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 4294967296;
}

export function generateCouponCode(rng: () => number = secureRandom): string {
  const pick = () => COUPON_ALPHABET[Math.floor(rng() * COUPON_ALPHABET.length)]!;
  const group = () => pick() + pick() + pick() + pick();
  return `${group()}-${group()}-${group()}`;
}

/** `count` distinct codes, skipping any in `taken`. */
export function generateCouponCodes(count: number, taken: Iterable<string> = [], rng?: () => number): string[] {
  const seen = new Set<string>(taken);
  const out: string[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 20) {
    const c = generateCouponCode(rng);
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** What a user typed → canonical `XXXX-XXXX-XXXX`, or null when it cannot be a code. */
export function normalizeCouponCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 12) return null;
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  return COUPON_CODE_RE.test(code) ? code : null;
}

export interface CouponCreateInput {
  kind: CouponKind;
  value: number;
  product: "complete" | "pass_guarantee";
  max_uses: number;
  expires_at: string | null;
  note: string | null;
  count: number;
}

export type CouponValidation = { ok: true; value: CouponCreateInput } | { ok: false; error: string };

/** Validate admin `coupons.create` params (V2_PLAN §6.2). */
export function validateCouponCreate(p: Record<string, unknown>): CouponValidation {
  const kind = p.kind;
  if (kind !== "percent" && kind !== "amount" && kind !== "gift") return { ok: false, error: "invalid_kind" };
  let value = typeof p.value === "number" && Number.isFinite(p.value) ? p.value : kind === "gift" ? 0 : NaN;
  if (kind === "gift") value = 0;
  if (!Number.isFinite(value) || value < 0) return { ok: false, error: "invalid_value" };
  if (kind === "percent" && (value <= 0 || value > 100)) return { ok: false, error: "invalid_percent" };
  if (kind === "amount" && value <= 0) return { ok: false, error: "invalid_amount" };
  const product = p.product === undefined ? "complete" : p.product;
  if (product !== "complete" && product !== "pass_guarantee") return { ok: false, error: "invalid_product" };
  const maxUses = p.max_uses === undefined ? 1 : p.max_uses;
  if (typeof maxUses !== "number" || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100_000) {
    return { ok: false, error: "invalid_max_uses" };
  }
  let expires: string | null = null;
  if (p.expires_at !== undefined && p.expires_at !== null) {
    if (typeof p.expires_at !== "string" || !Number.isFinite(Date.parse(p.expires_at))) {
      return { ok: false, error: "invalid_expires_at" };
    }
    expires = new Date(p.expires_at).toISOString();
  }
  const note = p.note === undefined || p.note === null ? null : p.note;
  if (note !== null && (typeof note !== "string" || note.length > 500)) return { ok: false, error: "invalid_note" };
  const count = p.count === undefined ? 1 : p.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > COUPON_MAX_BATCH) {
    return { ok: false, error: "invalid_count" };
  }
  return { ok: true, value: { kind, value, product, max_uses: maxUses, expires_at: expires, note, count } };
}
