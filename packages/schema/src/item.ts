import { z } from "zod";
import { BANK_ID_RE, isJurisdictionCode } from "./jurisdictions.js";

export const OPTION_LETTERS = ["A", "B", "C", "D"] as const;
export type OptionLetter = (typeof OPTION_LETTERS)[number];

export const CognitiveLevel = z.enum(["knowledge", "application", "analysis"]);
export const LicenseLevel = z.enum(["salesperson", "broker", "both"]);
export const Vendor = z.enum(["pearsonvue", "psi", "state", "other", "any"]);
/** `needs_review`: set by `pipeline watch-sources` when the cited authority changed under a live item; excluded from delivery until a reviewer re-approves. */
export const ItemStatus = z.enum(["draft", "verified", "qa_approved", "published", "needs_review", "retired"]);

/**
 * Item IDs: `<JUR>-<ROOT>-<NNNN>`
 *   JUR  = two-letter state code, or NAT for national banks
 *   ROOT = short statute/domain root, uppercase alnum (FL: "475", TX: "1101", NAT: "PV-IV")
 *   NNNN = 4+ digit sequence
 * Examples: FL-475-0413, TX-1101-0007, NAT-PV-IV-0012, NAT-PSI-3-0102
 */
export const ITEM_ID_RE = /^(NAT|[A-Z]{2})-[A-Z0-9]+(?:-[A-Z0-9]+)?-\d{4,}$/;

export const Citation = z.object({
  /** Proper legal citation, e.g. "Fla. Stat. § 475.25(1)(b)" or "12 U.S.C. § 2607(a)". */
  source: z.string().min(6),
  /** Official URL for the cited section (legislature / eCFR / commission rules). */
  url: z.url().nullable(),
  /** Verbatim excerpt from the cited section that supports the keyed answer. */
  quoted_text: z.string().min(20),
  /** Optional secondary authority (commission rule, federal reg). */
  secondary: z.array(z.object({ source: z.string(), url: z.url().nullable() })).default([]),
});

export const MathWork = z.object({
  /** Step-by-step worked solution shown to the learner. */
  worked_solution: z.string().min(20),
  /** Formula names used, e.g. ["proration", "loan-to-value"]. */
  formulas: z.array(z.string()).default([]),
  /** True in states that ban personal calculators (SPEC F15). Item must be solvable with the on-screen calculator. */
  onscreen_calculator_only: z.boolean().default(false),
});

export const Provenance = z.object({
  model: z.string().nullable(),
  prompt_version: z.string().nullable(),
  batch_id: z.string().nullable(),
  generated_on: z.iso.date().nullable(),
});

export const Item = z
  .object({
    id: z.string().regex(ITEM_ID_RE, "id must match <JUR>-<ROOT>-<NNNN>"),
    /** "NAT" for national banks, else the two-letter state code. */
    jurisdiction: z.string().refine((j) => j === "NAT" || isJurisdictionCode(j), "unknown jurisdiction"),
    bank: z.string().regex(BANK_ID_RE),
    /** Node id in the bank's blueprint, e.g. "IV.B" (national) or "3.2" (state outline). */
    blueprint_node: z.string().min(1),
    vendor: Vendor,
    license_level: LicenseLevel.default("both"),
    cognitive_level: CognitiveLevel,
    stem: z.string().min(20),
    options: z.array(z.string().min(1)).length(4),
    key: z.enum(OPTION_LETTERS),
    explanation: z.string().min(40),
    citation: Citation,
    math: MathWork.optional(),
    /** Glossary terms this item exercises (F16). */
    terms: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    status: ItemStatus,
    reviewer: z.string().nullable().default(null),
    verified_on: z.iso.date().nullable().default(null),
    /** Set when a licensed reviewer signs off (pipeline step 5). */
    qa_approved_on: z.iso.date().nullable().default(null),
    /** Why watch-sources pulled the item (`status: needs_review`); cleared when re-approved. */
    review_reason: z.string().nullable().optional(),
    version: z.number().int().min(1),
    provenance: Provenance.optional(),
  })
  .superRefine((item, ctx) => {
    const uniq = new Set(item.options.map((o) => o.trim().toLowerCase()));
    if (uniq.size !== 4) ctx.addIssue({ code: "custom", message: "options must be distinct", path: ["options"] });
    const jurFromId = item.id.split("-")[0];
    if (jurFromId !== item.jurisdiction)
      ctx.addIssue({ code: "custom", message: `id prefix ${jurFromId} != jurisdiction ${item.jurisdiction}`, path: ["id"] });
    const expectedBankPrefix = item.jurisdiction === "NAT" ? "national_" : `state_${item.jurisdiction}`;
    if (!item.bank.startsWith(expectedBankPrefix))
      ctx.addIssue({ code: "custom", message: `bank ${item.bank} does not match jurisdiction ${item.jurisdiction}`, path: ["bank"] });
    if (item.status !== "draft" && !item.verified_on)
      ctx.addIssue({ code: "custom", message: "non-draft items need verified_on", path: ["verified_on"] });
    if ((item.status === "qa_approved" || item.status === "published") && !item.reviewer)
      ctx.addIssue({ code: "custom", message: "qa_approved/published items need a reviewer", path: ["reviewer"] });
  });

export type Item = z.infer<typeof Item>;
export type ItemInput = z.input<typeof Item>;

/** The subset the drafting model is asked to produce. Everything else is stamped by the pipeline. */
export const DraftItem = z.object({
  cognitive_level: CognitiveLevel,
  stem: z.string().min(20),
  options: z.array(z.string().min(1)).length(4),
  key: z.enum(OPTION_LETTERS),
  explanation: z.string().min(40),
  citation: z.object({
    source: z.string().min(6),
    quoted_text: z.string().min(20),
  }),
  // Models frequently return the working as an array of steps, formulas as one string, or an empty
  // object instead of null; coerce those shapes before validating (the strict Item schema still applies).
  math: z.preprocess(
    (v) => {
      if (v === null || v === undefined || v === "" || v === "null") return null;
      if (typeof v !== "object") return v;
      const o = v as Record<string, unknown>;
      if (Object.keys(o).length === 0) return null;
      const ws = Array.isArray(o.worked_solution) ? o.worked_solution.map(String).join("\n") : o.worked_solution;
      const f = typeof o.formulas === "string" ? [o.formulas] : o.formulas ?? [];
      if ((ws === undefined || ws === null || String(ws).trim() === "") && (!Array.isArray(f) || f.length === 0)) return null;
      return { worked_solution: ws, formulas: f };
    },
    z.object({ worked_solution: z.string().min(20), formulas: z.array(z.string()).default([]) }).nullable(),
  ),
  terms: z.preprocess((v) => (v === null || v === undefined ? [] : typeof v === "string" ? [v] : v), z.array(z.string())),
});
export type DraftItem = z.infer<typeof DraftItem>;

export function keyIndex(key: OptionLetter): number {
  return OPTION_LETTERS.indexOf(key);
}
export function keyText(item: Pick<Item, "options" | "key">): string {
  return item.options[keyIndex(item.key)]!;
}
/** Top-level domain of a blueprint node: "IV.B.2" -> "IV", "3.2" -> "3". */
export function domainOf(node: string): string {
  return node.split(".")[0]!;
}
