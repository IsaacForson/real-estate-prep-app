/** Response helpers, error type and the request wrapper every function uses. */

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown> | undefined;
  constructor(status: number, code: string, message?: string, extra?: Record<string, unknown>) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-device-id, x-session-id",
  "access-control-allow-methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS, ...headers },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message?: string,
  extra?: Record<string, unknown>,
): Response {
  return json({ error: { code, message: message ?? code, ...(extra ?? {}) } }, status);
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Parse a json body, 400 on anything that is not a json object. */
export async function readJsonObject<T extends Record<string, unknown>>(req: Request): Promise<T> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "request body must be json");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_body", "request body must be a json object");
  }
  return parsed as T;
}

/** Shape of the error object supabase-js returns for postgrest / rpc failures. */
export interface PgErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/** Map postgres error codes raised by our sql functions to http. */
export function fromPgError(e: PgErrorLike, fallbackCode = "db_error"): HttpError {
  switch (e.code) {
    case "P0003": // raised by fn_register_device
      return new HttpError(409, "device_limit", e.details ?? e.message ?? "device limit reached");
    case "P0002":
      return new HttpError(404, "not_found", e.message);
    case "42501":
      return new HttpError(403, "forbidden", e.message);
    case "23514": // check_violation
    case "22P02": // invalid_text_representation (bad enum / uuid)
    case "22023":
      return new HttpError(400, "invalid_value", e.message);
    default:
      return new HttpError(500, fallbackCode, e.message ?? "database error", {
        pg_code: e.code ?? null,
      });
  }
}

export type Handler = (req: Request) => Promise<Response>;

/**
 * Wrap a handler: answers cors preflight, restricts to POST, converts HttpError to json and
 * hides anything else behind a 500 (logged). Every function's index.ts calls `serve(handler)`.
 */
export function serve(handler: Handler, opts: { methods?: string[] } = {}): void {
  const methods = opts.methods ?? ["POST"];
  Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return preflight();
    if (!methods.includes(req.method)) {
      return errorResponse(405, "method_not_allowed", `use ${methods.join(", ")}`);
    }
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) {
        return errorResponse(e.status, e.code, e.message, e.extra);
      }
      console.error("unhandled error", e);
      return errorResponse(500, "internal_error", "unexpected error");
    }
  });
}
