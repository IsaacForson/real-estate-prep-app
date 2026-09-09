/**
 * POST /functions/v1/study-state — server-backed learner settings + study plan (V2_PLAN §1, §6.3).
 *
 * headers: Authorization: Bearer <jwt>, x-device-hash
 * body:    { op: "get" }
 *          { op: "put", settings?: object (merged as a patch), plan?: object|null, replace_plan?: boolean,
 *            client_updated_at?: iso }   (lww on client_updated_at; equal / older writes are dropped)
 * returns: { settings, plan, client_updated_at, updated_at }
 *
 * the same row is readable and writable through postgrest under rls (`study_state`), this function
 * only adds the merge semantics and the device touch.
 */
import { authenticate } from "../_shared/auth.ts";
import { rpc, unwrap } from "../_shared/db.ts";
import { deviceFromRequest } from "../_shared/device.ts";
import { isIsoDate } from "../_shared/lww.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";

interface StateRequest extends Record<string, unknown> {
  op?: unknown;
  settings?: unknown;
  plan?: unknown;
  replace_plan?: unknown;
  client_updated_at?: unknown;
}

interface StateRow {
  user_id: string;
  settings: Record<string, unknown>;
  plan: Record<string, unknown> | null;
  client_updated_at: string;
  updated_at: string;
}

const MAX_JSON_BYTES = 64 * 1024;
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);

function shape(row: StateRow | null) {
  return {
    settings: row?.settings ?? {},
    plan: row?.plan ?? null,
    client_updated_at: row?.client_updated_at ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

serve(async (req) => {
  const ctx = await authenticate(req);
  const body = await readJsonObject<StateRequest>(req);
  await deviceFromRequest(req, ctx);

  if (body.op === "get") {
    const row = unwrap(
      await ctx.db.from("study_state").select("*").eq("user_id", ctx.userId).maybeSingle(),
      "study_state_get",
    ) as StateRow | null;
    return json(shape(row));
  }
  if (body.op !== "put") throw new HttpError(400, "invalid_op", "op must be get | put");

  const patch = body.settings === undefined ? null : body.settings;
  if (patch !== null && !isObj(patch)) throw new HttpError(400, "invalid_settings", "settings must be an object");
  const plan = body.plan === undefined ? null : body.plan;
  if (plan !== null && !isObj(plan)) throw new HttpError(400, "invalid_plan", "plan must be an object or null");
  const replacePlan = body.replace_plan === true || (body.plan === null);
  if (JSON.stringify(patch ?? {}).length + JSON.stringify(plan ?? {}).length > MAX_JSON_BYTES) {
    throw new HttpError(413, "too_large", "settings + plan must stay under 64 KB");
  }
  const clientUpdatedAt = isIsoDate(body.client_updated_at) ? body.client_updated_at : new Date().toISOString();

  const row = await rpc<StateRow>(ctx.db, "fn_study_state_put", {
    p_user_id: ctx.userId,
    p_settings_patch: patch,
    p_plan: plan,
    p_replace_plan: replacePlan,
    p_client_updated_at: clientUpdatedAt,
  });
  return json(shape(row));
});
