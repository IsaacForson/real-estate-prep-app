/** Environment access with clear failures. Values come from `supabase functions serve --env-file`
 *  locally and from `supabase secrets set` when hosted. */

export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v || v.trim() === "") {
    throw new Error(`missing required env var ${name} (see supabase/.env.example)`);
  }
  return v;
}

export function optionalEnv(name: string, fallback = ""): string {
  return Deno.env.get(name) ?? fallback;
}

export function intEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function boolEnv(name: string, fallback = false): boolean {
  const raw = Deno.env.get(name);
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}
