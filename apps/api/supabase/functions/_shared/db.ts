/** Supabase clients and a typed rpc helper. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env.ts";
import { fromPgError, type PgErrorLike } from "./response.ts";

// no generated Database type yet: the schema is small and every query is wrapped here.
export type Db = SupabaseClient;

let cached: Db | null = null;

/** Service-role client. Bypasses rls; every function must scope its own queries by user id. */
export function serviceClient(): Db {
  if (cached) return cached;
  cached = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Call a sql function and return its result, mapping postgres errors to HttpError. */
export async function rpc<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw fromPgError(error as PgErrorLike, `rpc_${fn}_failed`);
  return data as T;
}

/** Throw a mapped HttpError if a query returned one. */
export function unwrap<T>(result: { data: T | null; error: PgErrorLike | null }, what: string): T {
  if (result.error) throw fromPgError(result.error, `${what}_failed`);
  return result.data as T;
}

/** sha256 hex of a string. used for ip hashing and fingerprints. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
