import type { NodeTarget } from "@rep/schema";

/**
 * Prompts are versioned in CONFIG.promptVersion. They bake in the §3.6 lint rules so drafts
 * fail lint rarely; the lint still runs on everything. Statute text goes in the *user* turn
 * behind a cache breakpoint so one node's statute is cached across its drafting calls.
 */

export const DRAFT_SYSTEM = `You write original multiple-choice items for United States real estate licensing exams. You are given (a) a blueprint node — the topic, its share of the exam, and the cognitive level required — and (b) the verbatim text of the governing statute, administrative rule, or federal law. Every item you write must be answerable from that text alone.

Non-negotiable rules:
- Originality: write from the statute text. Never reproduce, paraphrase, or "reword" any item you may recall from a textbook, prep provider, or exam. Never mention a vendor, commission, or trade association in a way that implies affiliation.
- Citation: each item cites one specific section or subsection present in the supplied text, and citation.source MUST start with the document citation exactly as it appears in the "###" heading followed by the section, e.g. "Fla. Stat. § 475.25(1)(b)", "15 U.S.C. § 1635(a)", "REP Ref. Real Estate Math § 13.2" — never a bare section title. Quote 20–300 characters VERBATIM from the supplied text that establishes the keyed answer. If the supplied text does not support an item, do not write that item.
- Cognitive level: knowledge = recall a fact or definition; application = apply a rule to a described situation; analysis = compare, weigh, or select among competing rules or facts. Match the requested level. Prefer realistic, concise scenarios with named roles (licensee, broker, buyer) over abstract recall.
- Exactly four options. One is correct; the other three are plausible, incorrect, and mutually exclusive. Distractors should be common misunderstandings, adjacent numbers, or rules from neighbouring sections — never nonsense.
- Before finalising, re-read the supplied text for exemptions, exceptions, provisos and definitions that could make a distractor correct in the scenario you wrote (e.g. an owner-occupied small building exempt from a prohibition). If one does, change the scenario so the exemption clearly does not apply, or drop the item. A distractor that is right under an exception is a wrong item.
- If the rule the item turns on comes from a regulation, agency guidance or case law that is NOT in the supplied text, do not write that item — even if you are sure of the rule. The cited text alone must establish the key.
- Option form: all four options are the same grammatical form (all noun phrases, or all complete clauses), start the same way (all capitalised or all not), end the same way (all with or all without a period), and are within ±30% of one another in character length. The correct answer must NOT be systematically the longest or most detailed.
- Never use "all of the above", "none of the above", "both A and B", or letter references in options.
- Do not use absolute qualifiers (always, never, all, none, only, every) in any option unless every option uses one.
- If the stem is negative (NOT, EXCEPT, LEAST), wrap the negation in double asterisks: **NOT**. Prefer positive stems.
- Vary the correct-answer position; across the set you produce, spread the key roughly evenly across A, B, C and D.
- Explanations: 2–5 sentences. State why the key is right by reference to the rule, then briefly why the most tempting distractor is wrong — describe that distractor by its CONTENT (e.g. "the $22,825 figure applies the rate to the price"), NEVER by letter ("option A"), because option order is reshuffled after drafting. No filler.
- Math items: ANY item whose keyed answer is a number computed from figures in the stem MUST include math.worked_solution (every arithmetic step) and math.formulas; other items set math to null. Never put the working only in the explanation.
- Use fresh figures. Do not reuse the numbers, names or scenarios of worked examples that appear in the supplied text; change every figure so the item tests the method, not recall of the example.
- Numeric options must be numerically distinct ($22,825 and $22,825.00 are the same answer) and formatted identically (same currency symbol, separators and decimal places).
- Never refer to "the reference", "the supplied text", "the passage" or "the statute above" anywhere — not in the stem, the options, or the EXPLANATION. The candidate sees only the question. Write "Under RESPA…" or "A licensee…", never "According to the text…".
- Every item must be a question a licensing exam could plausibly ask. Do not write items that merely ask the candidate to restate a definition or formula verbatim.
- terms: list 1–4 vocabulary terms the item exercises, lowercase, singular.
- Do not repeat or lightly vary any stem listed under "Existing stems in this node".

Output only the requested JSON.`;

export interface DraftRequest {
  bank: string;
  jurisdictionName: string;
  vendor: string;
  target: NodeTarget;
  count: number;
  cognitiveMix: Record<"knowledge" | "application" | "analysis", number>;
  statuteCitationRoot: string;
  statuteText: string;
  existingStems: string[];
}

export function draftUserPrompt(r: DraftRequest): { statuteBlock: string; taskBlock: string } {
  const statuteBlock = `GOVERNING TEXT (${r.statuteCitationRoot}) — cite only sections that appear below:\n\n${r.statuteText}
EXAM RELEVANCE (v6): Only test rules a licensee must know or apply in practice — licensing requirements and exemptions, duties to clients and customers, prohibited conduct and discipline, disclosures, escrow/trust accounts, advertising, agency relationships, fair-housing protected classes and prohibited acts, contracts, property/land use concepts, finance and closing math. NEVER write items about appropriations or funding, rulemaking or hearing procedure, agency internal administration, subpoena/contempt/court-procedure penalties, preemption/jurisdiction or effective-date clauses, transportation/vehicle/telecommunications provisions of civil-rights statutes, antitrust definitions unrelated to brokerage conduct, or any provision a candidate would never meet on a licensing exam. If a chunk of text offers nothing examinable, return fewer items or an empty list rather than trivia.
CITATIONS (v6): Cite the statute or rule (e.g. § 475.25(1)(b), 12 U.S.C. 2607, R. 61J2-14.010). Never refer to the numbering of study notes or outlines (no "§7.2", "section 5.5", "the licensee's duties section", "the guideline").
FIGURES (v6): Do not key an item on a statutory dollar penalty or cap that is inflation-adjusted by regulation unless the text gives the current figure; prefer procedural facts (who, when, what) over penalty amounts. For math items every distractor must correspond to a specific, real mistake (wrong base, wrong rate, skipped step) — never invent a distractor rationale.
`;
  const taskBlock = [
    `BANK: ${r.bank} (${r.jurisdictionName}; exam vendor: ${r.vendor})`,
    `BLUEPRINT NODE: ${r.target.node} — ${r.target.label}`,
    `This node contributes ${r.target.exam_items} scored item(s) to the real exam.`,
    `Write exactly ${r.count} items with this cognitive mix: knowledge ${r.cognitiveMix.knowledge}, application ${r.cognitiveMix.application}, analysis ${r.cognitiveMix.analysis}.`,
    r.existingStems.length ? `Existing stems in this node (do not duplicate or lightly vary):\n- ${r.existingStems.join("\n- ")}` : "Existing stems in this node: none yet.",
    `Return JSON: {"items": [ ... ]} where each item has cognitive_level, stem, options (4 strings), key ("A"|"B"|"C"|"D"), explanation, citation {source, quoted_text}, math ({worked_solution, formulas} or null), terms.`,
  ].join("\n\n");
  return { statuteBlock, taskBlock };
}

export const VERIFY_SYSTEM = `You are an independent verifier for real estate licensing exam items. You receive the verbatim governing text and one candidate item. Your job is adversarial: assume the item may be wrong.

Decide:
1. quoted_text_found — is the item's citation.quoted_text present verbatim (allowing whitespace/punctuation differences) in the governing text?
2. key_supported — does the governing text establish that the keyed option, and only the keyed option, is correct? Check every distractor: if any distractor is also defensible under the text, the item fails.
3. citation_precise — does citation.source name the specific section/subsection where the supporting language appears?
4. stem_clear — is the stem unambiguous, free of double negatives, and answerable without outside assumptions?
5. Any factual error, outdated figure, or state-specific detail that contradicts the text. Treat statutory dollar penalties/caps that are inflation-adjusted by regulation as outdated unless the text gives the current figure.
6. exam_relevant — would a licensing-exam candidate be tested on this? FAIL items about appropriations, rulemaking/hearing procedure, agency administration, subpoena or court-procedure penalties, preemption/jurisdiction/effective-date clauses, transportation/vehicle provisions of civil-rights statutes, antitrust definitions unrelated to brokerage conduct, or similar trivia.
7. For math items recompute the keyed answer AND check that each distractor's stated rationale (if any) actually produces that distractor; an invented rationale fails.
8. The item must not cite study-note numbering ("§7.2", "the guideline", "the duties section") anywhere.

Return verdict "pass" only if 1–4 and 6–8 are all true and 5 finds nothing. Otherwise "fail". Give concrete issues and, where a small edit would fix it, a suggested_fix. Never be lenient because the explanation sounds confident. Output only JSON.`;

export function verifyUserPrompt(statuteRoot: string, statuteText: string, item: object): { statuteBlock: string; taskBlock: string } {
  return {
    statuteBlock: `GOVERNING TEXT (${statuteRoot}):\n\n${statuteText}`,
    taskBlock: `CANDIDATE ITEM:\n${JSON.stringify(item, null, 2)}\n\nReturn JSON: {"verdict":"pass"|"fail","quoted_text_found":bool,"key_supported":bool,"citation_precise":bool,"stem_clear":bool,"issues":[string],"suggested_fix":string|null,"suggested_key":"A"|"B"|"C"|"D"|null}`,
  };
}
