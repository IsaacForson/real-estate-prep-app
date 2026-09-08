/**
 * `pipeline qa-packet <bank> [--status verified|draft] [--limit N] [--out dir]`
 * Writes one Markdown review packet per item: the item exactly as the learner sees it, then the
 * cited authority's enclosing section (located from the quoted text), then the six reviewer checks
 * from docs/QA_REVIEWER_GUIDE.md. A reviewer reads packets and records verdicts with qa-approve /
 * qa-reject. Also writes an index.md listing packets.
 */
import { join } from "node:path";
import { Item } from "@rep/schema";
import { loadItems } from "@rep/content-lint";
import { CONFIG } from "./config.js";
import { loadStatutes } from "./statutes.js";
import { locateQuote, excerptAround } from "./cite.js";
import { writeText, listFiles, readYaml } from "./fsx.js";

export function writeQaPackets(bank: string, opts: { status?: string; limit?: number; out?: string; ids?: string[] } = {}): { dir: string; count: number } {
  const status = opts.status ?? "verified";
  let items: Item[];
  if (status === "draft") items = listFiles(join(CONFIG.stateDir, "drafts", bank), ".yaml").map((p) => Item.parse(readYaml(p)));
  else items = loadItems(CONFIG.contentDir).items.map((x) => x.value).filter((i) => i.bank === bank && i.status === status);
  if (opts.ids?.length) { const set = new Set(opts.ids); items = items.filter((i) => set.has(i.id)); }
  if (opts.limit) items = items.slice(0, opts.limit);
  const jur = bank.startsWith("state_") ? bank.slice(6) : "NAT";
  const docs = loadStatutes(jur);
  const dir = opts.out ?? join(CONFIG.stateDir, "qa-packets", bank);
  const index: string[] = [`# QA packets — ${bank} (${status}) — ${items.length} items`, ""];
  for (const it of items) {
    const hit = locateQuote(docs, it.citation.quoted_text);
    const excerpt = hit ? excerptAround(hit.doc.text, hit.index, 4000) : "(quoted text NOT FOUND in any cached authority — automatic reject)";
    const md = [
      `# ${it.id} — ${it.bank} · node ${it.blueprint_node} · ${it.cognitive_level}`,
      "",
      `**Stem.** ${it.stem}`,
      "",
      ...it.options.map((o, i) => `- **${"ABCD"[i]}.** ${o}`),
      "",
      `**Key:** ${it.key}`,
      "",
      `**Explanation.** ${it.explanation}`,
      it.math ? `\n**Worked solution.** ${it.math.worked_solution}` : "",
      "",
      `**Citation.** ${it.citation.source}`,
      `> ${it.citation.quoted_text}`,
      "",
      `## Authority text (${hit ? hit.doc.citation : "not located"})`,
      "",
      "```",
      excerpt,
      "```",
      "",
      "## Reviewer checks (docs/QA_REVIEWER_GUIDE.md)",
      "1. Key right per the authority text? 2. Exactly one defensible option? 3. Stem fair (no tricks, negation bolded)?",
      "4. Tests what the exam tests (not trivia)? 5. Explanation states the rule and why the tempting distractor is wrong? 6. Math recomputed?",
      "",
      `Verdict: \`pnpm pipeline qa-approve <reviewer> ${it.id}\` or \`pnpm pipeline qa-reject <reviewer> ${it.id} "<reason>"\``,
      "",
    ].join("\n");
    writeText(join(dir, `${it.id}.md`), md);
    index.push(`- [${it.id}](${it.id}.md) — ${it.blueprint_node} · ${it.cognitive_level} · ${it.citation.source}${hit ? "" : " · **quote not found**"}`);
  }
  writeText(join(dir, "index.md"), index.join("\n") + "\n");
  return { dir, count: items.length };
}
