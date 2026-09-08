import { z } from "zod";
import { CognitiveLevel } from "./item.js";

const CogSplit = z.partialRecord(CognitiveLevel, z.number().nonnegative().nullable());

const Subtopic = z.object({
  id: z.string().min(1),
  label: z.string().min(2),
  items: z.number().nonnegative().nullable().default(null),
  /** Published as a range, e.g. "2-3"; `items` holds the lower bound. */
  items_range: z.string().nullable().optional(),
  broker_only: z.boolean().optional(),
  /** Statute sections that ground this node (state blueprints). Used to select statute text when drafting. */
  statute_refs: z.array(z.string()).default([]),
}).loose();

export const Domain = z.object({
  id: z.string().min(1),
  label: z.string().min(2),
  items: z.number().nonnegative(),
  /** PSI publishes weights, not counts; `items` is our rounding onto scored_items. */
  weight_pct: z.number().nonnegative().optional(),
  cognitive_split: CogSplit.optional(),
  /** Alias used in the research YAML. Prefer cognitive_split; both are read. */
  cognitive: CogSplit.optional(),
  subtopics: z.array(Subtopic).default([]),
}).loose();

export const ExamBlueprint = z.object({
  scored_items: z.number().positive(),
  /** Number, or free text when the vendor publishes a range ("1-10"). */
  pretest_items: z.union([z.number().nonnegative(), z.string()]).nullable().default(null),
  cognitive_split: CogSplit.optional(),
  domains: z.array(Domain).min(1),
}).loose();

/**
 * Internal blueprint for one bank. Labels are our own paraphrases; vendor outline text is
 * never reproduced (SPEC §3.2). `exams.salesperson` is required; `broker` optional.
 */
export const Blueprint = z.object({
  id: z.string().regex(/^(national_pearsonvue|national_psi|state_[A-Z]{2})$/),
  vendor: z.enum(["pearsonvue", "psi", "state", "other"]),
  title: z.string(),
  source_document: z.string().nullable(),
  source_url: z.url().nullable(),
  source_version_or_date: z.string().nullable(),
  accessed: z.iso.date(),
  copyright_note: z.string(),
  exams: z.object({ salesperson: ExamBlueprint, broker: ExamBlueprint.optional() }),
  references: z.array(z.object({ title: z.string(), author: z.string().nullable().optional(), publisher: z.string().nullable().optional() }).loose()).default([]),
  notes: z.string().nullable().default(null),
}).loose();
export type Blueprint = z.infer<typeof Blueprint>;
export type Domain = z.infer<typeof Domain>;
export type CognitiveSplit = z.infer<typeof CogSplit>;

/** Bank sizing: how many bank items each exam item should be backed by. */
export const BANK_ITEMS_PER_EXAM_ITEM = 11;

export interface NodeTarget {
  node: string;
  label: string;
  exam_items: number;
  target_bank_items: number;
  cognitive_split?: CognitiveSplit;
}

export function domainCognitive(d: Domain): CognitiveSplit | undefined {
  return d.cognitive_split ?? d.cognitive;
}

/**
 * Compute per-node bank targets from a blueprint (used by `pipeline plan`).
 * If a domain's subtopic counts are all published and sum to the domain count, targets are
 * per subtopic; otherwise the domain is one node. Cognitive split is inherited from the domain.
 */
export function nodeTargets(bp: Blueprint, exam: "salesperson" | "broker" = "salesperson", ratio = BANK_ITEMS_PER_EXAM_ITEM): NodeTarget[] {
  const e = bp.exams[exam];
  if (!e) return [];
  const out: NodeTarget[] = [];
  for (const d of e.domains) {
    const subs = d.subtopics.filter((s) => s.items != null);
    const cog = domainCognitive(d);
    if (subs.length === d.subtopics.length && subs.length > 0 && subs.reduce((a, s) => a + (s.items ?? 0), 0) === d.items) {
      for (const s of subs)
        out.push({ node: s.id, label: s.label, exam_items: s.items!, target_bank_items: Math.ceil(s.items! * ratio), cognitive_split: cog });
    } else {
      out.push({ node: d.id, label: d.label, exam_items: d.items, target_bank_items: Math.ceil(d.items * ratio), cognitive_split: cog });
    }
  }
  return out;
}
