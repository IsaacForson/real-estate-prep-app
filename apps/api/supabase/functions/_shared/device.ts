/**
 * V2_PLAN §1 device tracking. Every client call carries `x-device-hash` (sha256 hex of a stable
 * install / vendor id). The pure part (`effectiveFreeTier`) decides how much free tier is left when
 * consumption is counted per account *and* per device; the db part records the device and asks
 * fn_touch_device_fingerprint to apply the "≥3 accounts in 30 days" rule.
 */
import { type Db, rpc } from "./db.ts";
import type { AuthContext } from "./auth.ts";
import { FREE_TIER_ITEMS, FREE_TIER_MOCKS } from "./limits.ts";

export const DEVICE_HASH_RE = /^[0-9a-f]{64}$/;

/** Validated `x-device-hash` header or null. */
export function deviceHashFromHeaders(headers: Headers): string | null {
  const v = headers.get("x-device-hash")?.trim().toLowerCase() ?? "";
  return DEVICE_HASH_RE.test(v) ? v : null;
}

export interface FreeTierInputs {
  userQuestions: number;
  userMocks: number;
  /** null when the request carried no device hash (legacy client): only the account counts. */
  deviceQuestions: number | null;
  deviceMocks: number | null;
  deviceBlocked: boolean;
  /** fn_touch_device_fingerprint marked the device as shared by ≥3 accounts in 30 days. */
  deviceExhausted: boolean;
  limits?: { questions: number; mocks: number };
}

export type FreeTierReason = "ok" | "questions" | "mocks" | "device_blocked" | "device_shared";

export interface FreeTierState {
  questions_used: number;
  mocks_used: number;
  questions_remaining: number;
  mocks_remaining: number;
  total: number;
  /** nothing is left for practice (mocks may still be possible when reason is "questions"). */
  exhausted: boolean;
  reason: FreeTierReason;
}

const nonNeg = (
  n: number | null | undefined,
): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * A device inherits the *maximum* of account and device consumption, so "clear storage + new
 * email" starts where the device left off. A blocked or shared device has no free tier at all.
 */
export function effectiveFreeTier(i: FreeTierInputs): FreeTierState {
  const limits = i.limits ?? { questions: FREE_TIER_ITEMS, mocks: FREE_TIER_MOCKS };
  const questionsUsed = Math.max(nonNeg(i.userQuestions), nonNeg(i.deviceQuestions));
  const mocksUsed = Math.max(nonNeg(i.userMocks), nonNeg(i.deviceMocks));
  if (i.deviceBlocked || i.deviceExhausted) {
    return {
      questions_used: questionsUsed,
      mocks_used: mocksUsed,
      questions_remaining: 0,
      mocks_remaining: 0,
      total: limits.questions,
      exhausted: true,
      reason: i.deviceBlocked ? "device_blocked" : "device_shared",
    };
  }
  const qRemaining = Math.max(0, limits.questions - questionsUsed);
  const mRemaining = Math.max(0, limits.mocks - mocksUsed);
  return {
    questions_used: questionsUsed,
    mocks_used: mocksUsed,
    questions_remaining: qRemaining,
    mocks_remaining: mRemaining,
    total: limits.questions,
    exhausted: qRemaining === 0,
    reason: qRemaining === 0 ? "questions" : mRemaining === 0 ? "mocks" : "ok",
  };
}

export interface DeviceTouch {
  account_count: number;
  accounts_30d: number;
  blocked: boolean;
  exhausted: boolean;
  flagged: boolean;
}

/** Record this (device, account) pair. Never throws: a tracking failure must not block study. */
export async function touchDevice(
  db: Db,
  deviceHash: string | null,
  userId: string | null,
  opts: { platform?: string | null; model?: string | null } = {},
): Promise<DeviceTouch | null> {
  if (!deviceHash) return null;
  try {
    const rows = await rpc<DeviceTouch[]>(db, "fn_touch_device_fingerprint", {
      p_device_hash: deviceHash,
      p_user_id: userId,
      p_platform: opts.platform ?? null,
      p_model: opts.model ?? null,
    });
    return rows[0] ?? null;
  } catch (e) {
    console.warn("fn_touch_device_fingerprint failed", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Effective free tier for (user, device, jurisdiction): max of both scopes plus device flags. */
export async function freeTierFor(
  db: Db,
  userId: string,
  deviceHash: string | null,
  jurisdiction: string,
  touch: DeviceTouch | null = null,
): Promise<FreeTierState> {
  const [userRows, deviceRows] = await Promise.all([
    rpc<{ questions_used: number; mocks_used: number }[]>(db, "fn_user_free_tier", {
      p_user_id: userId,
      p_jurisdiction: jurisdiction,
    }),
    deviceHash
      ? rpc<
        { questions_used: number; mocks_used: number; blocked: boolean; exhausted: boolean; account_count: number }[]
      >(
        db,
        "fn_device_free_tier",
        { p_device_hash: deviceHash, p_jurisdiction: jurisdiction },
      )
      : Promise.resolve([]),
  ]);
  const u = userRows[0] ?? { questions_used: 0, mocks_used: 0 };
  const d = deviceRows[0] ?? null;
  return effectiveFreeTier({
    userQuestions: u.questions_used,
    userMocks: u.mocks_used,
    deviceQuestions: d ? d.questions_used : null,
    deviceMocks: d ? d.mocks_used : null,
    deviceBlocked: (d?.blocked ?? false) || (touch?.blocked ?? false),
    deviceExhausted: (d?.exhausted ?? false) || (touch?.exhausted ?? false),
  });
}

/** Add consumption to both scopes. Never throws. */
export async function bumpFreeTier(
  db: Db,
  userId: string,
  deviceHash: string | null,
  jurisdiction: string,
  questions: number,
  mocks = 0,
): Promise<void> {
  try {
    await rpc<null>(db, "fn_bump_free_tier_usage", {
      p_user_id: userId,
      p_device_hash: deviceHash,
      p_jurisdiction: jurisdiction,
      p_questions: questions,
      p_mocks: mocks,
    });
  } catch (e) {
    console.warn("fn_bump_free_tier_usage failed", e instanceof Error ? e.message : e);
  }
}

/** Convenience for the user-facing functions: device hash from the request + fingerprint touch. */
export async function deviceFromRequest(
  req: Request,
  ctx: Pick<AuthContext, "db" | "userId">,
  opts: { platform?: string | null; model?: string | null } = {},
): Promise<{ deviceHash: string | null; touch: DeviceTouch | null }> {
  const deviceHash = deviceHashFromHeaders(req.headers);
  const touch = await touchDevice(ctx.db, deviceHash, ctx.userId, opts);
  return { deviceHash, touch };
}
