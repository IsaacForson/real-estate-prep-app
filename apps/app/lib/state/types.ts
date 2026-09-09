/**
 * Shapes shared by the repository layer (lib/state/repo.ts), its cache/remote adapters and the
 * composables that read through it. Server rows follow docs/V2_PLAN.md §2 / §6.3; the learner's
 * per-item progress and sessions keep the 0006 wire shapes in lib/study/sync.ts because
 * `sync-progress` is the endpoint that resolves public ids and applies last-write-wins.
 */
import type { Plan } from "../study/plan.js";
import type { Progress, StudySession } from "../study/types.js";

export type { Plan, Progress, StudySession };

/** Learner-scoped settings. Theme is deliberately NOT here: it stays on the device (V2 §6.1). */
export interface StudySettings {
  jurisdiction: string;
  licenseLevel: "salesperson" | "broker";
  examDate: string | null;
  narrationRate: number;
  autoAdvance: boolean;
  sharingNoticeAck: boolean;
  sessionSize: number;
}

export function defaultSettings(): StudySettings {
  return { jurisdiction: "", licenseLevel: "salesperson", examDate: null, narrationRate: 1, autoAdvance: false, sharingNoticeAck: false, sessionSize: 20 };
}

/** Accept whatever the server / cache holds and produce a complete settings object. */
export function normalizeSettings(v: unknown): StudySettings {
  const d = defaultSettings();
  if (!v || typeof v !== "object") return d;
  const r = v as Record<string, unknown>;
  return {
    jurisdiction: typeof r.jurisdiction === "string" ? r.jurisdiction : d.jurisdiction,
    licenseLevel: r.licenseLevel === "broker" ? "broker" : "salesperson",
    examDate: typeof r.examDate === "string" && r.examDate ? r.examDate : null,
    narrationRate: typeof r.narrationRate === "number" && Number.isFinite(r.narrationRate) ? r.narrationRate : d.narrationRate,
    autoAdvance: r.autoAdvance === true,
    sharingNoticeAck: r.sharingNoticeAck === true,
    sessionSize: typeof r.sessionSize === "number" && r.sessionSize > 0 ? Math.round(r.sessionSize) : d.sessionSize,
  };
}

/** `study_state(user_id pk, settings jsonb, plan jsonb, updated_at)` — LWW on `updated_at` (V2 §2). */
export interface StudyStateRow {
  user_id: string;
  settings: StudySettings;
  plan: Plan | null;
  /** iso; the client stamps its own clock so two devices resolve by last write */
  updated_at: string;
}

/** What the cache keeps for study_state: the row plus the ms clock used for LWW comparisons. */
export interface CachedStudyState {
  settings: StudySettings;
  plan: Plan | null;
  updatedAt: number;
}

export type OutboxKind = "progress" | "session" | "study_state" | "event";

/**
 * One pending write. `key` dedupes (newest wins): `progress:<itemId>`, `session:<id>`,
 * `study_state`, `event:<uuid>`. `at` is the client clock of the write so a replay can tell whether
 * the entry it just pushed is still the current one.
 */
export interface OutboxEntry {
  key: string;
  kind: OutboxKind;
  payload: unknown;
  at: number;
  attempts: number;
}

/** V2 §2 `events.kind`. */
export type EventKind =
  | "app_open" | "sign_in" | "sign_out" | "answer" | "session_start" | "session_resume" | "mock_start" | "mock_finish"
  | "purchase_started" | "purchase_succeeded" | "purchase_failed" | "restore" | "review_submitted" | "help_search"
  | "help_ai_question" | "ticket_created" | "coupon_redeemed" | "settings_changed" | "content_refreshed";

export const EVENT_KINDS: readonly EventKind[] = [
  "app_open", "sign_in", "sign_out", "answer", "session_start", "session_resume", "mock_start", "mock_finish",
  "purchase_started", "purchase_succeeded", "purchase_failed", "restore", "review_submitted", "help_search",
  "help_ai_question", "ticket_created", "coupon_redeemed", "settings_changed", "content_refreshed",
];

/** Wire shape of one event in `track-event { events: [...] }` (V2 §6.3). */
export interface WireEvent {
  kind: EventKind;
  props: Record<string, unknown>;
  /** iso */
  at: string;
}
