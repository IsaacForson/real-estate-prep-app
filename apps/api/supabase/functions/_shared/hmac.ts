/**
 * HMAC-SHA256 helpers (web crypto, no deps) plus the batch signature scheme from SPEC §5.4.
 * Pure; unit-tested in hmac.test.ts.
 */

const enc = new TextEncoder();

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return new Uint8Array(sig);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return toHex(await hmacSha256(secret, message));
}

export async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  return toBase64Url(await hmacSha256(secret, message));
}

/** Constant-time string comparison. Always walks max(len) characters. */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// batch signatures
// ---------------------------------------------------------------------------

/** What the signature commits to. The client stores it with the batch and the server (or a
 *  future offline verifier holding a derived key) can prove the batch was issued to this user. */
export interface BatchClaims {
  batch_id: string;
  user_id: string;
  issued_at: string; // iso
  expires_at: string; // iso
  public_ids: string[];
}

/** Deterministic string form; json key order is not guaranteed so we do not sign json. */
export function canonicalBatchString(c: BatchClaims): string {
  return [
    "rep-batch-v1",
    c.batch_id,
    c.user_id,
    c.issued_at,
    c.expires_at,
    c.public_ids.join(","),
  ].join("\n");
}

export async function signBatch(claims: BatchClaims, secret: string): Promise<string> {
  return await hmacSha256Base64Url(secret, canonicalBatchString(claims));
}

export type BatchVerification =
  | { ok: true }
  | { ok: false; reason: "expired" | "bad_signature" | "malformed" };

export async function verifyBatch(
  claims: BatchClaims,
  signature: string,
  secret: string,
  now: Date = new Date(),
): Promise<BatchVerification> {
  const exp = Date.parse(claims.expires_at);
  if (!Number.isFinite(exp) || !Array.isArray(claims.public_ids)) return { ok: false, reason: "malformed" };
  const expected = await signBatch(claims, secret);
  if (!timingSafeEqual(expected, signature)) return { ok: false, reason: "bad_signature" };
  if (exp <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}
