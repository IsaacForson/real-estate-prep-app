/**
 * Local-lint repair — salvage drafts that fail only "wording" rules (explanation refers to option
 * letters or to "the text", stem cites study-note numbering, negative not bolded, option form).
 * These were 118 of 143 local rejections in the 2026-09-08 PV run. The router rewrites ONLY the
 * offending fields; the key, the keyed option text and the citation are never touched, and the
 * result must pass lintItem before it is accepted. Repaired items go on to the verifier like any draft.
 */
import { z } from "zod";
import { Item, keyIndex } from "@rep/schema";
import { LlmRouter, chatJson } from "@rep/llm";
import { lintItem } from "@rep/content-lint";

export const REPAIRABLE = new Set([
  "explanation-option-letter",
  "explanation-option-ordinal",
  "meta-reference-in-explanation",
  "meta-reference-in-stem",
  "negative-stem-not-bolded",
  "option-form-opening",
  "option-form-punctuation",
  "absolute-qualifier",
]);

/** True when every reason is a lint rule in REPAIRABLE (quote/citation failures are not repairable). */
export function isRepairable(reasons: string[]): boolean {
  if (!reasons.length) return false;
  return reasons.every((r) => {
    const m = /^lint:([a-z-]+):/.exec(r);
    return !!m && REPAIRABLE.has(m[1]!);
  });
}

const Rewrite = z.object({
  stem: z.string().min(20),
  options: z.array(z.string().min(1)).length(4),
  explanation: z.string().min(40),
  changed: z.array(z.string()),
});

const SYSTEM = `You repair the wording of a multiple-choice real estate licensing exam item so it passes editorial rules. You receive the item and the list of failed checks. Rules:
- Never change which option is correct. Never change the text of the CORRECT option. Keep the citation as is.
- Explanations must teach the rule in plain words and cite the statute/rule section; never refer to options by letter ("option B") — describe the option's content instead; never say "the text/reference/passage/section/guideline says"; never cite study-note numbering like "§7.2" — cite the statute or rule instead.
- When the citation source is a "REP Ref." reference note (not a statute or rule), the explanation must not mention any section number at all — state the rule plainly ("Writing a new contract clause from scratch is drafting, which is the unauthorized practice of law…").
- Stems must be answerable by a candidate who has NOT seen any notes: no "according to the reference/section"; a negative stem must bold the negative word with markdown (**NOT**, **EXCEPT**).
- Wrong options may be lightly reworded only when a check requires it (grammatical form, absolutes); they must stay wrong.
Return JSON {"stem": string, "options": [4 strings, same order], "explanation": string, "changed": [field names]}.`;

export async function repairItem(router: LlmRouter, item: Item, reasons: string[]): Promise<{ item: Item; changed: boolean; note: string }> {
  const k = keyIndex(item.key);
  const user = [
    `ITEM:\n${JSON.stringify({ stem: item.stem, options: item.options, key: item.key, correct_option_text: item.options[k], explanation: item.explanation, citation: item.citation }, null, 2)}`,
    `FAILED CHECKS:\n${reasons.map((r) => `- ${r}`).join("\n")}`,
  ].join("\n\n");
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data } = await chatJson(router, Rewrite, [{ role: "system", content: SYSTEM }, { role: "user", content: user + feedback }], { maxTokens: 1800, temperature: 0.3 + 0.2 * attempt });
    const options = [...data.options];
    options[k] = item.options[k]!; // the keyed option is never rewritten
    const out: Item = { ...item, stem: data.stem, options, explanation: data.explanation, version: item.version + 1 };
    const problems = lintItem(out).filter((f) => f.severity === "error").map((f) => `${f.rule}: ${f.message}`);
    if (!problems.length) return { item: out, changed: true, note: `repaired: ${data.changed.join(", ") || "wording"}` };
    feedback = `\n\nYOUR PREVIOUS ATTEMPT STILL FAILED: ${problems.join("; ")}. Fix them.`;
  }
  return { item, changed: false, note: "repair did not converge" };
}

/**
 * `pipeline repair <id...>` — rewrite wording on items already in content/items (e.g. approved items
 * caught by a widened lint rule). Repaired items drop back to `verified` so QA re-reviews them.
 */
export async function repairContentItems(ids: string[], log: (s: string) => void = console.log): Promise<{ repaired: string[]; unchanged: string[] }> {
  const { loadProviders } = await import("@rep/llm");
  const { readYaml, writeYaml } = await import("./fsx.js");
  const { CONFIG } = await import("./config.js");
  const { join } = await import("node:path");
  const { readdirSync } = await import("node:fs");
  const router = new LlmRouter(loadProviders("verify")); router.log = log;
  const root = join(CONFIG.contentDir, "items");
  const all = readdirSync(root, { recursive: true, withFileTypes: false }).map(String).filter((f) => f.endsWith(".yaml")).map((f) => join(root, f));
  const repaired: string[] = [], unchanged: string[] = [];
  for (const id of ids) {
    const path = all.find((p) => p.endsWith(`/${id}.yaml`));
    if (!path) { log(`${id}: not found`); unchanged.push(id); continue; }
    const item = Item.parse(readYaml(path));
    const reasons = lintItem(item).filter((f) => f.severity === "error").map((f) => `lint:${f.rule}: ${f.message}`);
    if (!reasons.length) { log(`${id}: already lint-clean`); unchanged.push(id); continue; }
    const r = await repairItem(router, item, reasons);
    if (!r.changed) { log(`${id}: ${r.note}`); unchanged.push(id); continue; }
    writeYaml(path, { ...r.item, status: "verified", qa_approved_on: null, reviewer: null, review_reason: `wording repaired ${new Date().toISOString().slice(0, 10)} (${reasons.map((x) => x.split(":")[1]).join(", ")}); re-review` });
    log(`${id}: ${r.note} → verified v${r.item.version}`);
    repaired.push(id);
  }
  return { repaired, unchanged };
}
