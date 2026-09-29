/**
 * Rehab — reprocess rejected items through expanded auto-repair.
 *
 * Flow per item:
 *   1. Re-parse from .pipeline/rejected/<bank>/<id>.yaml
 *   2. Apply deterministic fixes: normalizeDraft (bold negations, source normalization,
 *      section marker fix, option shuffle, ref-tag stripping)
 *   3. Fuzzy quote relocation — if quoted_text fails verbatim check, try to find the
 *      actual statute text and swap it in
 *   4. Re-run localCheck
 *   5. If only REPAIRABLE lint failures remain → LLM repair
 *   6. Re-run localCheck after repair
 *   7. Passing items move to .pipeline/drafts/<bank>/ for remote verification
 *   8. Still-failing items stay in rejected (updated with new rejection reasons)
 */
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import { Item } from "@rep/schema";
import { LlmRouter, loadProviders, mapLimit } from "@rep/llm";
import { lintItem } from "@rep/content-lint";
import { CONFIG } from "./config.js";
import { listFiles, readYaml, writeYaml } from "./fsx.js";
import { loadStatutes, quoteAppears, fuzzyRelocateQuote } from "./statutes.js";
import { localCheck, reject, jurOf } from "./verify.js";
import { normalizeDraft } from "./normalize.js";
import { isRepairable, repairItem } from "./repair.js";

export interface RehabResult {
  total: number;
  deterministic_fixed: number;
  quote_relocated: number;
  llm_repaired: number;
  recovered: number;
  still_rejected: number;
}

export async function rehabBank(bank: string, opts: { limit?: number; log?: (s: string) => void } = {}): Promise<RehabResult> {
  const log = opts.log ?? console.log;
  const rejDir = join(CONFIG.stateDir, "rejected", bank);
  const files = listFiles(rejDir, ".yaml");
  if (!files.length) { log(`rehab ${bank}: no rejected items`); return { total: 0, deterministic_fixed: 0, quote_relocated: 0, llm_repaired: 0, recovered: 0, still_rejected: 0 }; }

  const jur = jurOf(bank);
  const statutes = loadStatutes(jur);
  const texts = statutes.map((s) => s.text);
  if (!statutes.length) { log(`rehab ${bank}: no statutes for ${jur}`); return { total: 0, deterministic_fixed: 0, quote_relocated: 0, llm_repaired: 0, recovered: 0, still_rejected: 0 }; }

  const limit = opts.limit ?? files.length;
  const candidates = files.slice(0, limit);
  log(`rehab ${bank}: processing ${candidates.length} rejected items`);

  let deterministic_fixed = 0, quote_relocated = 0, llm_repaired = 0, recovered = 0, still_rejected = 0;
  const needsLlmRepair: Array<{ path: string; item: Item; reasons: string[] }> = [];

  // Phase 1: deterministic fixes
  for (const path of candidates) {
    const raw = readYaml(path) as Record<string, unknown>;
    const parsed = Item.safeParse(raw);
    if (!parsed.success) { still_rejected++; continue; }

    let item = parsed.data;

    // Apply normalize (bold negations, source normalization, section marker fix)
    item = normalizeDraft(item, statutes);

    // Fuzzy quote relocation
    if (!texts.some((t) => quoteAppears(item.citation.quoted_text, t))) {
      const relocated = fuzzyRelocateQuote(item.citation.quoted_text, statutes);
      if (relocated) {
        item = { ...item, citation: { ...item.citation, quoted_text: relocated.verbatim } };
        quote_relocated++;
      }
    }

    // Re-check
    const lc = localCheck(item, texts);
    if (lc.ok) {
      // Move to drafts for remote verification
      writeYaml(join(CONFIG.stateDir, "drafts", bank, `${item.id}.yaml`), item);
      unlinkSync(path);
      deterministic_fixed++;
      recovered++;
      continue;
    }

    // Check if remaining failures are LLM-repairable
    if (isRepairable(lc.reasons)) {
      needsLlmRepair.push({ path, item, reasons: lc.reasons });
    } else {
      // Update rejection with new reasons
      writeYaml(path, { ...raw, rejection: { on: new Date().toISOString().slice(0, 10), reasons: lc.reasons } });
      still_rejected++;
    }
  }

  log(`rehab ${bank}: phase 1 done — ${deterministic_fixed} fixed deterministically, ${quote_relocated} quotes relocated, ${needsLlmRepair.length} need LLM repair, ${still_rejected} still rejected`);

  // Phase 2: LLM repair for items with only REPAIRABLE lint failures
  if (needsLlmRepair.length) {
    const router = new LlmRouter(loadProviders("verify")); router.log = log;
    const results = await mapLimit(needsLlmRepair, 4, async ({ path, item, reasons }) => {
      try {
        const r = await repairItem(router, item, reasons);
        if (r.changed) {
          const lc2 = localCheck(r.item, texts);
          if (lc2.ok) {
            writeYaml(join(CONFIG.stateDir, "drafts", bank, `${r.item.id}.yaml`), r.item);
            unlinkSync(path);
            llm_repaired++;
            recovered++;
            log(`  ${r.item.id}: ${r.note} → drafts`);
            return;
          }
        }
      } catch (e) {
        log(`  ${item.id}: repair error — ${String(e).slice(0, 120)}`);
      }
      still_rejected++;
    });
    for (const r of results) if (!r.ok) { still_rejected++; log(`  FAILED: ${String(r.error).slice(0, 200)}`); }
  }

  log(`rehab ${bank}: done — ${recovered} recovered (${deterministic_fixed} deterministic + ${llm_repaired} LLM), ${still_rejected} still rejected`);
  return { total: candidates.length, deterministic_fixed, quote_relocated, llm_repaired, recovered, still_rejected };
}
