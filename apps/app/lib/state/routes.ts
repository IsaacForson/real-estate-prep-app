/**
 * Auth-first routing rules (V2 §1, §6.1), as pure functions so middleware/auth.global.ts is a
 * thin shell and the list is unit-tested.
 */

/** Routes a signed-out visitor may open. `/**` entries match the prefix and everything under it. */
export const PUBLIC_ROUTES = ["/", "/pricing", "/states/**", "/methodology", "/legal/**", "/welcome", "/signin", "/help", "/reviews"] as const;

export const WELCOME_PATH = "/welcome";

function normalize(path: string): string {
  const p = path.split(/[?#]/)[0] ?? "/";
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

export function isPublicPath(path: string): boolean {
  const p = normalize(path);
  for (const rule of PUBLIC_ROUTES) {
    if (rule.endsWith("/**")) {
      const base = rule.slice(0, -3);
      if (p === base || p.startsWith(base + "/")) return true;
    } else if (p === rule) return true;
  }
  return false;
}

export interface RouteDecisionInput {
  path: string;
  signedIn: boolean;
  /** Capacitor native shell: the landing page does not exist, `/` goes to the welcome carousel. */
  native: boolean;
  /** No Supabase configured (static dev mode): nothing is gated. */
  authConfigured: boolean;
}

/** Where to send the navigation instead, or null to let it through. */
export function authRedirect(o: RouteDecisionInput): string | null {
  if (!o.authConfigured) return null;
  const p = normalize(o.path);
  // Native has no marketing site: "/" always resolves to somewhere useful — the study loop when
  // signed in, the onboarding carousel otherwise. Letting a signed-in visit render the landing page
  // (the previous `null` here) was the bug where reopening the app showed the website, not the app.
  if (o.native && p === "/") return o.signedIn ? "/app" : WELCOME_PATH;
  if (o.signedIn) return null;
  return isPublicPath(p) ? null : WELCOME_PATH;
}
