/**
 * Sign-in / sign-out hook registry. `useAuth().init()` must hydrate entitlement, device, study
 * state and the free tier BEFORE `ready` flips (no flash of free-tier UI, V2 §6.1), but those live
 * in composables that themselves depend on useAuth. The bootstrap composable registers closures
 * here at setup time; useAuth runs them in registration order without importing anything.
 */

export interface SignedInContext {
  uid: string;
  /** `init` = session restored at launch; `sign_in` = the user just verified a code */
  event: "init" | "sign_in";
}

export type SignedInHook = (ctx: SignedInContext) => Promise<void> | void;
export type SignedOutHook = (reason: "user" | "revoked" | "expired") => Promise<void> | void;

const signedIn: SignedInHook[] = [];
const signedOut: SignedOutHook[] = [];

export function onSignedIn(fn: SignedInHook): () => void {
  signedIn.push(fn);
  return () => { const i = signedIn.indexOf(fn); if (i >= 0) signedIn.splice(i, 1); };
}
export function onSignedOut(fn: SignedOutHook): () => void {
  signedOut.push(fn);
  return () => { const i = signedOut.indexOf(fn); if (i >= 0) signedOut.splice(i, 1); };
}

export function signedInHookCount(): number { return signedIn.length; }

/** Sequential, each hook isolated: one failing hook never blocks the others or the app. Returns how many ran. */
export async function runSignedIn(ctx: SignedInContext, onError: (e: unknown) => void = () => {}): Promise<number> {
  const hooks = [...signedIn];
  for (const fn of hooks) {
    try { await fn(ctx); } catch (e) { onError(e); }
  }
  return hooks.length;
}
export async function runSignedOut(reason: Parameters<SignedOutHook>[0], onError: (e: unknown) => void = () => {}): Promise<void> {
  for (const fn of [...signedOut]) {
    try { await fn(reason); } catch (e) { onError(e); }
  }
}

/** Await `p` but never longer than `ms`; the work keeps running in the background. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(undefined); });
  });
}

/** tests only */
export function _resetHooks(): void { signedIn.length = 0; signedOut.length = 0; }
