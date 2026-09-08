import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  type BatchClaims,
  canonicalBatchString,
  hmacSha256Hex,
  signBatch,
  timingSafeEqual,
  verifyBatch,
} from "./hmac.ts";

// rfc 4231 test case 2: key "Jefe", data "what do ya want for nothing?"
Deno.test("hmacSha256Hex matches rfc 4231 vector", async () => {
  const hex = await hmacSha256Hex("Jefe", "what do ya want for nothing?");
  assertEquals(hex, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
});

Deno.test("timingSafeEqual", () => {
  assert(timingSafeEqual("abc", "abc"));
  assert(!timingSafeEqual("abc", "abd"));
  assert(!timingSafeEqual("abc", "abcd"));
  assert(!timingSafeEqual("", "a"));
  assert(timingSafeEqual("", ""));
});

const claims: BatchClaims = {
  batch_id: "3f0b0a2e-6a57-4a1e-9b1a-1f4c3a2b1c00",
  user_id: "8c1a4c2e-9f4c-4d8e-8a1e-0b2c3d4e5f60",
  issued_at: "2026-09-08T10:00:00.000Z",
  expires_at: "2026-09-08T16:00:00.000Z",
  public_ids: ["a1b2c3", "d4e5f6", "g7h8i9"],
};
const secret = "test-secret-do-not-use";

Deno.test("canonical string is order-sensitive on public ids", () => {
  const a = canonicalBatchString(claims);
  const b = canonicalBatchString({ ...claims, public_ids: [...claims.public_ids].reverse() });
  assertNotEquals(a, b);
});

Deno.test("sign + verify round trip", async () => {
  const sig = await signBatch(claims, secret);
  assertEquals(await verifyBatch(claims, sig, secret, new Date("2026-09-08T12:00:00Z")), { ok: true });
});

Deno.test("verify rejects tampering, wrong secret and expiry", async () => {
  const sig = await signBatch(claims, secret);
  const at = new Date("2026-09-08T12:00:00Z");
  assertEquals(
    await verifyBatch({ ...claims, public_ids: ["a1b2c3", "zzz", "g7h8i9"] }, sig, secret, at),
    { ok: false, reason: "bad_signature" },
  );
  assertEquals(await verifyBatch(claims, sig, "other-secret", at), { ok: false, reason: "bad_signature" });
  assertEquals(
    await verifyBatch(claims, sig, secret, new Date("2026-09-08T16:00:00Z")),
    { ok: false, reason: "expired" },
  );
  assertEquals(
    await verifyBatch({ ...claims, expires_at: "not-a-date" }, sig, secret, at),
    { ok: false, reason: "malformed" },
  );
});
