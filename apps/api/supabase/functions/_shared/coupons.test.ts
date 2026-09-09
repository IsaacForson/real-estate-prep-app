import { assert, assertEquals } from "@std/assert";
import {
  COUPON_ALPHABET,
  COUPON_CODE_RE,
  generateCouponCode,
  generateCouponCodes,
  normalizeCouponCode,
  validateCouponCreate,
} from "./coupons.ts";
import { seededRng } from "./batch.ts";

Deno.test("coupon alphabet has no look-alike characters", () => {
  for (const c of "0O1IL") assert(!COUPON_ALPHABET.includes(c), `alphabet must not contain ${c}`);
  assertEquals(new Set(COUPON_ALPHABET).size, COUPON_ALPHABET.length);
});

Deno.test("generateCouponCode: XXXX-XXXX-XXXX from the alphabet, deterministic with a seeded rng", () => {
  const a = generateCouponCode(seededRng(42));
  const b = generateCouponCode(seededRng(42));
  assertEquals(a, b);
  assert(COUPON_CODE_RE.test(a), a);
  for (const ch of a.replace(/-/g, "")) assert(COUPON_ALPHABET.includes(ch));
  // crypto default works too
  assert(COUPON_CODE_RE.test(generateCouponCode()));
});

Deno.test("generateCouponCodes: distinct and skips taken codes", () => {
  const rng = seededRng(7);
  const first = generateCouponCode(seededRng(7));
  const codes = generateCouponCodes(50, [first], rng);
  assertEquals(codes.length, 50);
  assertEquals(new Set(codes).size, 50);
  assert(!codes.includes(first));
});

Deno.test("normalizeCouponCode accepts what a user types", () => {
  assertEquals(normalizeCouponCode("abcd-efgh-jkmn"), "ABCD-EFGH-JKMN");
  assertEquals(normalizeCouponCode(" abcd efgh jkmn "), "ABCD-EFGH-JKMN");
  assertEquals(normalizeCouponCode("ABCDEFGHJKMN"), "ABCD-EFGH-JKMN");
  assertEquals(normalizeCouponCode("ABCD-EFGH"), null);
  assertEquals(normalizeCouponCode(12), null);
  assertEquals(normalizeCouponCode(""), null);
});

Deno.test("validateCouponCreate enforces V2 §6.2 params", () => {
  const gift = validateCouponCreate({ kind: "gift", count: 3, note: "launch friends" });
  assert(gift.ok);
  if (gift.ok) {
    assertEquals(gift.value.value, 0);
    assertEquals(gift.value.product, "complete");
    assertEquals(gift.value.max_uses, 1);
    assertEquals(gift.value.count, 3);
  }
  const pct = validateCouponCreate({ kind: "percent", value: 25, max_uses: 100, expires_at: "2027-01-01T00:00:00Z" });
  assert(pct.ok);
  if (pct.ok) assertEquals(pct.value.expires_at, "2027-01-01T00:00:00.000Z");
  assertEquals(validateCouponCreate({ kind: "percent", value: 120 }), { ok: false, error: "invalid_percent" });
  assertEquals(validateCouponCreate({ kind: "amount", value: 0 }), { ok: false, error: "invalid_amount" });
  assertEquals(validateCouponCreate({ kind: "bogus" }), { ok: false, error: "invalid_kind" });
  assertEquals(validateCouponCreate({ kind: "gift", product: "gold" }), { ok: false, error: "invalid_product" });
  assertEquals(validateCouponCreate({ kind: "gift", count: 0 }), { ok: false, error: "invalid_count" });
  assertEquals(validateCouponCreate({ kind: "gift", count: 10_000 }), { ok: false, error: "invalid_count" });
  assertEquals(validateCouponCreate({ kind: "gift", max_uses: 0 }), { ok: false, error: "invalid_max_uses" });
  assertEquals(validateCouponCreate({ kind: "gift", expires_at: "soon" }), { ok: false, error: "invalid_expires_at" });
});
