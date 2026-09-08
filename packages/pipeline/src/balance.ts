/**
 * Distractor balancing — the "longest answer is right" death spiral (SPEC §3.6). Models write the
 * keyed option with more detail than the distractors. When the key is the longest option by a
 * margin, ask the router to rewrite ONLY the three distractors to the key's length and specificity,
 * keeping them wrong and mutually exclusive. The key text is never touched. A balanced item goes
 * back through verification (and QA) because its distractors changed.
 */
import { z } from "zod";
import { Item, OPTION_LETTERS, keyIndex } from "@rep/schema";
import { LlmRouter, chatJson } from "@rep/llm";
import { lintItem } from "@rep/content-lint";

export const BALANCE_MARGIN = 0; // key strictly longer than every distractor → rebalance (lint counts "unique longest")

export function needsBalancing(item: Item): boolean {
  const k = keyIndex(item.key);
  const keyLen = item.options[k]!.trim().length;
  const maxOther = Math.max(...item.options.filter((_, i) => i !== k).map((o) => o.trim().length));
  return keyLen > maxOther * (1 + BALANCE_MARGIN);
}

const Rewrite = z.object({ distractors: z.array(z.string().min(3)).length(3), rationale: z.string() });

const SYSTEM = `You repair multiple-choice distractors for a real estate licensing exam item. You receive the stem, the CORRECT option (which you must not change or paraphrase), the three current wrong options, and the authority text the item rests on. Rewrite the three wrong options so that each is (a) still clearly WRONG under the authority text, (b) plausible — a common misunderstanding, an adjacent number, or a rule from a neighbouring provision, (c) the same grammatical form as the correct option, and (d) within ±15% of the correct option's character length, with a comparable level of specific detail (names, numbers, conditions). Do not make any distractor arguably correct. Do not use "all/none of the above" or absolute words. Return JSON {"distractors": [three strings in the same order as given], "rationale": "one sentence"}.`;

export async function balanceItem(router: LlmRouter, item: Item, authorityExcerpt: string): Promise<{ item: Item; changed: boolean; rationale: string }> {
  const k = keyIndex(item.key);
  const others = item.options.map((o, i) => ({ o, i })).filter((x) => x.i !== k);
  const user = [
    `STEM: ${item.stem}`,
    `CORRECT OPTION (do not change): ${item.options[k]}`,
    `CURRENT WRONG OPTIONS:\n${others.map((x, n) => `${n + 1}. ${x.o}`).join("\n")}`,
    `AUTHORITY TEXT:\n${authorityExcerpt.slice(0, 6000)}`,
  ].join("\n\n");
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data } = await chatJson(router, Rewrite, [{ role: "system", content: SYSTEM }, { role: "user", content: user + feedback }], { maxTokens: 1200, temperature: 0.4 + 0.2 * attempt });
    const options = [...item.options];
    others.forEach((x, n) => { options[x.i] = data.distractors[n]!; });
    const out: Item = { ...item, options, version: item.version + 1 };
    // the rewrite must itself pass the per-item option rules and must dethrone the key as unique longest
    const problems = lintItem(out).filter((f) => f.severity === "error" && /option|absolute|numerically/.test(f.rule)).map((f) => f.message);
    if (needsBalancing(out)) problems.push("the correct option is still the single longest option; make at least one distractor as long or longer");
    if (!problems.length) return { item: out, changed: options.some((o, i) => o !== item.options[i]), rationale: data.rationale };
    feedback = `\n\nYOUR PREVIOUS ATTEMPT FAILED THESE CHECKS: ${problems.join("; ")}. Fix them.`;
  }
  return { item, changed: false, rationale: "could not produce lint-clean balanced distractors; item left unchanged" };
}
