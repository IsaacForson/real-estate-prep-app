/**
 * Thin client for the apps/api edge functions (`/functions/v1/<name>`). Every function answers
 * `{ error: { code, message, ...extra } }` on failure (see apps/api `_shared/response.ts`); this
 * turns that into an `ApiError` the composables can branch on by `code`.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, message?: string, extra: Record<string, unknown> = {}) {
    super(message ?? code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** This device's session was revoked: evicted by a newer device, removed from the Devices list, disabled (SPEC §5.3). */
export function isSessionRevoked(e: unknown): e is ApiError {
  return e instanceof ApiError && e.code === "session_revoked";
}
/**
 * The `{ reason, details }` of the most recent 401 session_revoked seen by any call, so a caller that
 * only learns "revoked" second-hand (itemSource's `onSessionRevoked()` carries no error) can still
 * explain it. Cleared once read.
 */
let lastRevocation: Record<string, unknown> | null = null;
export function takeLastRevocation(): Record<string, unknown> | null {
  const r = lastRevocation;
  lastRevocation = null;
  return r;
}
/** Device / session headers missing or unknown: register-device must run (again). */
export function isSessionRequired(e: unknown): e is ApiError {
  return e instanceof ApiError && e.code === "session_required";
}
/** 402 free_tier_exhausted, 403 free_tier_one_state / free_tier_mock_* / home_jurisdiction_required. */
export function isFreeTierError(e: unknown): e is ApiError {
  return e instanceof ApiError && (e.code.startsWith("free_tier") || e.code === "home_jurisdiction_required");
}
export function isRateLimited(e: unknown): e is ApiError {
  return e instanceof ApiError && e.code === "rate_limited";
}
/** Network failure or 5xx: the local store keeps working, retry later. */
export function isTransient(e: unknown): boolean {
  return (e instanceof ApiError && e.status >= 500) || (e instanceof TypeError);
}

/** V2 §1: every function call carries the install's device hash (see lib/state/device.ts). */
export const DEVICE_HASH_HEADER = "x-device-hash";
let deviceHashProvider: (() => string | null | undefined) | null = null;
/** Registered once by useDevice(); tests may register their own. */
export function setDeviceHashProvider(fn: (() => string | null | undefined) | null): void {
  deviceHashProvider = fn;
}
/** Add `x-device-hash` when a hash is known and the caller did not set one. */
export function withDeviceHash(headers: Record<string, string>): Record<string, string> {
  const hash = deviceHashProvider?.();
  if (!hash || headers[DEVICE_HASH_HEADER]) return headers;
  return { ...headers, [DEVICE_HASH_HEADER]: hash };
}

export function functionsBase(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1`;
}

export async function callFunction<T>(
  base: string,
  name: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${base}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...withDeviceHash(headers) },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* non-json body */ }
  if (!res.ok) {
    const err = (parsed as { error?: Record<string, unknown> } | null)?.error;
    const code = typeof err?.code === "string" ? err.code : `http_${res.status}`;
    const message = typeof err?.message === "string" ? err.message : res.statusText;
    const { code: _c, message: _m, ...extra } = err ?? {};
    if (code === "session_revoked") lastRevocation = extra;
    throw new ApiError(res.status, code, message, extra);
  }
  return parsed as T;
}
