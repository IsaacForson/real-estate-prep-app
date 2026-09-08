import { z } from "zod";
import { isJurisdictionCode } from "./jurisdictions.js";

export const ExamVendor = z.enum(["pearsonvue", "psi", "state", "other"]);
export const Grading = z.enum(["combined", "separate"]);

const nn = z.number().nonnegative().nullable();
const ns = z.string().nullable();

export const ExamFormat = z.object({
  national_items: nn,
  state_items: nn,
  total_items: nn,
  pretest_items: z.union([z.number().nonnegative(), z.string()]).nullable(),
  time_minutes: nn,
  pass_score_national: ns,
  pass_score_state: ns,
  pass_score_combined: ns,
  grading: Grading.nullable(),
  exam_fee_usd: nn,
  retake_policy: ns.optional(),
  calculator_policy: ns.optional(),
});
export type ExamFormat = z.infer<typeof ExamFormat>;

export const Source = z.object({
  url: z.url(),
  used_for: z.array(z.string()).default([]),
  accessed: z.iso.date(),
});

/** One row of Deliverable 0 — the 51-row state map (SPEC §3.3). */
export const StateRecord = z.object({
  code: z.string().refine(isJurisdictionCode, "unknown jurisdiction code"),
  name: z.string().min(2),
  regulator: z.object({ name: z.string().min(2), url: z.url().nullable() }),
  vendor: ExamVendor,
  vendor_notes: ns,
  salesperson_exam: ExamFormat,
  broker_exam: ExamFormat.partial().nullable(),
  prelicense_hours_salesperson: nn,
  prelicense_hours_broker: nn,
  statute_citation_root: ns,
  rules_citation_root: ns,
  statute_url: z.url().nullable(),
  rules_url: z.url().nullable(),
  bulletin_url: z.url().nullable(),
  exam_outline_url: z.url().nullable(),
  sources: z.array(Source).default([]),
  unverified: z.array(z.string()).default([]),
  confidence: z.enum(["high", "medium", "low"]),
  last_verified: z.iso.date(),
  notes: ns,
});
export type StateRecord = z.infer<typeof StateRecord>;

/** Fields that must be non-null before a state can be marked launch-ready in-app. */
export const LAUNCH_CRITICAL_FIELDS = [
  "vendor",
  "salesperson_exam.state_items",
  "salesperson_exam.total_items",
  "salesperson_exam.time_minutes",
  "salesperson_exam.grading",
  "statute_citation_root",
  "bulletin_url",
] as const;

/** Which national bank a jurisdiction's candidates should study. */
export function nationalBankFor(vendor: z.infer<typeof ExamVendor>): "national_pearsonvue" | "national_psi" | null {
  if (vendor === "pearsonvue") return "national_pearsonvue";
  if (vendor === "psi") return "national_psi";
  return null; // state-administered: decided per state in the blueprint (see docs)
}
