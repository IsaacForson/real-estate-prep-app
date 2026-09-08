/**
 * SPEC §5.3 anomaly heuristics, pure. Inputs are already-aggregated numbers or small row lists
 * so the functions are trivially testable. The response to any flag is a re-verification email
 * (fn_open_anomaly_flag inserts into email_outbox); nothing here blocks a request.
 */
import { ANOMALY_ANSWERS_PER_HOUR, ANOMALY_DISTINCT_DEVICES_30D, ANOMALY_DISTINCT_REGIONS_24H } from "./limits.ts";

export type AnomalyKind = "devices_30d" | "geo_24h" | "answer_velocity";

export interface AnomalyLimits {
  devices30d: number;
  regions24h: number;
  answersPerHour: number;
}

export const DEFAULT_ANOMALY_LIMITS: AnomalyLimits = {
  devices30d: ANOMALY_DISTINCT_DEVICES_30D,
  regions24h: ANOMALY_DISTINCT_REGIONS_24H,
  answersPerHour: ANOMALY_ANSWERS_PER_HOUR,
};

export interface GeoEvent {
  region_key: string;
  created_at: string;
}

/** Distinct known regions inside the trailing window. "unknown" never counts. */
export function distinctRegions(events: GeoEvent[], now: Date, windowHours = 24): number {
  const since = now.getTime() - windowHours * 3600_000;
  const set = new Set<string>();
  for (const e of events) {
    if (e.region_key === "unknown") continue;
    const t = Date.parse(e.created_at);
    if (Number.isFinite(t) && t > since && t <= now.getTime() + 60_000) set.add(e.region_key);
  }
  return set.size;
}

export interface AnswerDelta {
  attempts_delta: number;
  last_answered_at: string | null;
}

/** Sum of newly applied attempts whose answer time falls in the trailing window. */
export function answersInWindow(deltas: AnswerDelta[], now: Date, windowHours = 1): number {
  const since = now.getTime() - windowHours * 3600_000;
  let n = 0;
  for (const d of deltas) {
    if (d.attempts_delta <= 0 || d.last_answered_at === null) continue;
    const t = Date.parse(d.last_answered_at);
    // clock skew guard: answers "from the future" still count against the current window.
    if (Number.isFinite(t) && t > since) n += d.attempts_delta;
  }
  return n;
}

export interface AnomalyInputs {
  distinctFingerprints30d: number;
  distinctRegions24h: number;
  answersLastHour: number;
}

export interface AnomalyFinding {
  kind: AnomalyKind;
  details: Record<string, number>;
}

/** Strictly-greater-than thresholds, per SPEC wording ("more than 3", "exceeding"). */
export function detectAnomalies(
  input: AnomalyInputs,
  limits: AnomalyLimits = DEFAULT_ANOMALY_LIMITS,
): AnomalyFinding[] {
  const out: AnomalyFinding[] = [];
  if (input.distinctFingerprints30d > limits.devices30d) {
    out.push({
      kind: "devices_30d",
      details: { distinct_fingerprints: input.distinctFingerprints30d, limit: limits.devices30d },
    });
  }
  if (input.distinctRegions24h > limits.regions24h) {
    out.push({ kind: "geo_24h", details: { distinct_regions: input.distinctRegions24h, limit: limits.regions24h } });
  }
  if (input.answersLastHour > limits.answersPerHour) {
    out.push({
      kind: "answer_velocity",
      details: { answers_last_hour: input.answersLastHour, limit: limits.answersPerHour },
    });
  }
  return out;
}
