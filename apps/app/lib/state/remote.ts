/**
 * The repository's server side (V2 §4): PostgREST under RLS for `study_state`, the `sync-progress`
 * function for progress + sessions (it resolves public ids and applies last-write-wins), and
 * `track-event` for the analytics outbox. Every call carries `x-device-hash` (lib/study/api.ts).
 * Framework-free: the supabase client and header providers are injected.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, callFunction } from "../study/api.js";
import type { SyncPayload, SyncResponse } from "../study/sync.js";
import { normalizeSettings, type StudyStateRow, type WireEvent } from "./types.js";

export interface RemoteStore {
  /** `sync-progress`: push outbox rows, pull rows newer than `since`. Throws ApiError / TypeError. */
  sync(payload: SyncPayload): Promise<SyncResponse>;
  /** `study_state` row for the signed-in user, null when none yet. Throws on transport/RLS errors. */
  getStudyState(): Promise<StudyStateRow | null>;
  /** Upsert; returns the row the server holds afterwards (null when a server-side LWW rule kept its own). */
  putStudyState(row: StudyStateRow): Promise<StudyStateRow | null>;
  /** `track-event` with a batch of ≤ 50 events. */
  trackEvents(events: WireEvent[]): Promise<void>;
}

export interface SupabaseRemoteDeps {
  supabase: SupabaseClient;
  /** `${supabaseUrl}/functions/v1` */
  base: string;
  uid: () => string | null;
  /** Bearer + apikey; null when signed out. */
  authHeaders: () => Promise<Record<string, string> | null>;
  /** authHeaders + x-device-id / x-session-id; null until register-device ran. */
  apiHeaders: () => Promise<Record<string, string> | null>;
  /** apikey only — track-event accepts anon + device hash. */
  anonHeaders: () => Record<string, string>;
  fetchImpl?: typeof fetch;
}

export const STUDY_STATE_TABLE = "study_state";

export function parseStudyStateRow(x: unknown): StudyStateRow | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.user_id !== "string" || typeof r.updated_at !== "string" || !Number.isFinite(Date.parse(r.updated_at))) return null;
  return {
    user_id: r.user_id,
    settings: normalizeSettings(r.settings),
    plan: r.plan && typeof r.plan === "object" ? (r.plan as StudyStateRow["plan"]) : null,
    updated_at: r.updated_at,
  };
}

export class SupabaseRemote implements RemoteStore {
  constructor(private deps: SupabaseRemoteDeps) {}

  async sync(payload: SyncPayload): Promise<SyncResponse> {
    const headers = await this.deps.apiHeaders();
    if (!headers) throw new ApiError(401, "session_required", "device not registered yet");
    const body: Record<string, unknown> = { progress: payload.progress, study_sessions: payload.study_sessions };
    if (payload.since) body.since = payload.since;
    return callFunction<SyncResponse>(this.deps.base, "sync-progress", body, headers, this.deps.fetchImpl);
  }

  async getStudyState(): Promise<StudyStateRow | null> {
    const uid = this.deps.uid();
    if (!uid) throw new ApiError(401, "not_signed_in");
    const { data, error } = await this.deps.supabase.from(STUDY_STATE_TABLE).select("user_id, settings, plan, updated_at").eq("user_id", uid).maybeSingle();
    if (error) throw new ApiError(500, error.code || "postgrest_error", error.message);
    return data ? parseStudyStateRow(data) : null;
  }

  async putStudyState(row: StudyStateRow): Promise<StudyStateRow | null> {
    const { data, error } = await this.deps.supabase
      .from(STUDY_STATE_TABLE)
      .upsert({ user_id: row.user_id, settings: row.settings, plan: row.plan, updated_at: row.updated_at }, { onConflict: "user_id" })
      .select("user_id, settings, plan, updated_at")
      .maybeSingle();
    if (error) throw new ApiError(500, error.code || "postgrest_error", error.message);
    return data ? parseStudyStateRow(data) : null;
  }

  async trackEvents(events: WireEvent[]): Promise<void> {
    const headers = (await this.deps.authHeaders()) ?? this.deps.anonHeaders();
    await callFunction<unknown>(this.deps.base, "track-event", { events }, headers, this.deps.fetchImpl);
  }
}
