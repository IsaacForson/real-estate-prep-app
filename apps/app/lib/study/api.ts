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

/** The account's single live session moved to another device (SPEC §5.3). */
export function isSessionRevoked(e: unknown): e is ApiError {
  return e instanceof ApiError && e.code === "session_revoked";
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
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* non-json body */ }
  if (!res.ok) {
    const err = (parsed as { error?: Record<string, unknown> } | null)?.error;
    const code = typeof err?.code === "string" ? err.code : `http_${res.status}`;
    const message = typeof err?.message === "string" ? err.message : res.statusText;
    const { code: _c, message: _m, ...extra } = err ?? {};
    throw new ApiError(res.status, code, message, extra);
  }
  return parsed as T;
}
