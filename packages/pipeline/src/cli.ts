#!/usr/bin/env tsx
import { CONFIG, repoRoot as repoRootDir } from "./config.js";
import { fetchStatute, saveStatute, today, loadStatutes, pdfToText } from "./statutes.js";
import { planBank } from "./plan.js";
import { submitDraftBatch, collectBatch } from "./draft.js";
import { submitVerifyBatch, collectVerifyBatch } from "./verify.js";
import { qaSheet, qaApprove, qaReject, publish } from "./qa.js";
import { buildMocks } from "./mocks.js";
import { computeStatus, renderStatus, writeStatusMarkdown } from "./status.js";
import { auditRefs, renderAudit } from "./refsAudit.js";
import { writeQaPackets } from "./qaPacket.js";
import { draftDirect, verifyDirect } from "./direct.js";
import { buildGlossary, reviewGlossary } from "./glossary.js";
import { needsBalancing, balanceItem } from "./balance.js";
import { assignKeyPositions } from "./normalize.js";
import { locateQuote, excerptAround } from "./cite.js";
import { LlmRouter } from "@rep/llm";
import { Item, domainOf } from "@rep/schema";
import { loadItems } from "@rep/content-lint";
import { renderAudio } from "./audio.js";
import { watchSources, renderWatchSummary } from "./watch.js";
import { publishRemote } from "./remote.js";
import { formsBuild } from "./forms.js";
import { loadEnv } from "@rep/llm";
loadEnv();
const BACKEND = process.env.LLM_BACKEND ?? "router";
import { readFileSync } from "node:fs";
import { readJson, listFiles, readYaml, writeYaml } from "./fsx.js";
import { join } from "node:path";

const [cmd, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1]!.startsWith("--")));

const HELP = `pipeline — content factory (SPEC §3.5)

  ingest <JUR> "<citation>" <url> ["<title>"]     fetch statute HTML → content/statutes/<JUR>/
  ingest <JUR> "<citation>" --file <path.txt|.pdf> ["<title>"] [--url <source>]   ingest a local text or PDF file
  statutes <JUR>                                    list cached statute docs
  plan <bank>                                       per-node targets vs existing items
  draft <bank> [--nodes I,II] [--limit N] [--dry-run]   draft items now via the free-tier router (LLM_BACKEND=router, default) or submit an Anthropic batch (LLM_BACKEND=anthropic); --dry-run writes requests to .pipeline/dry-run
  collect <batchId>                                 pull draft results → .pipeline/drafts/<bank>/
  verify <bank>                                     gate 3a locally, then verifier (router: immediate; anthropic: batch)
  collect-verify <batchId>                          pull verdicts → content/items (pass) / .pipeline/rejected (fail)
  batches                                           list known batches
  keys <bank>                                       assign key positions round-robin per domain (exactly uniform A/B/C/D)
  balance <bank>                                    rewrite distractors on content items whose key is the longest option; item returns to "verified" for re-review
  requeue <bank> [--match "substring"]              move rejected drafts whose reasons match back to drafts (after fixing a rule)
  qa-packet <bank> [--status verified|draft] [--limit N] [--out dir]   one Markdown review packet per item (item + cited authority section)
  wait <batchId>                                    poll a batch until it ends, then collect (draft) or collect-verify (verify)
  qa-sheet <bank> [--sample 0.2]                    reviewer CSV of a random sample of verified items
  qa-approve <reviewer> <id...>                     stamp qa_approved
  node-brief <bank> [--nodes I,II.A]                write per-node drafting briefs (authority text, gaps, covered rules) to .pipeline/briefs
  import-drafts <bank> <file.json>                  agent-written {node, items[]} JSON → lint/quote-checked drafts
  verify-local <bank>                               drafts passing local checks → content (status verified, provisional)
  repair <id...>                                    LLM-rewrite wording of content items failing lint → back to verified
  qa-reject <reviewer> <id> "<reason>"              retire an item
  publish <bank> [--include-verified]               qa_approved (and verified, if flagged) → published
  publish --remote [<bank>] [--dry-run] [--force-version] [--backfill]   upload qa_approved/published items to the Supabase 'content' bucket + item_index / item_content / content_versions / content_alerts (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY); --backfill upserts every published item's item_content row
  forms-build <bank|XX> [--remote] [--forms 5]      assemble non-overlapping mock forms (national: short + full; state: short + form-1..N) from approved items; --remote upserts them into mock_forms
  watch-sources [--bank <id>] [--dry-run] [--skip-blocked] [--concurrency N]   re-fetch every cached authority URL, hash-compare, flag items whose citations changed → needs_review, docs/STATUTE_CHANGES.md, .pipeline/watch/
  refs-audit [XX|bank] [--verbose]                  resolve every blueprint node's statute_refs against cached authorities
  glossary <bank> [--limit N]                       define the bank's item terms from cached authorities → content/glossary/<bank>.yaml (F16)
  glossary-approve <bank> <reviewer> <term...> / glossary-reject <bank> <reviewer> "<reason>" <term...>
  audio-render <bank> [--limit N] [--status qa_approved,published]   pre-generate narration MP3s → content/audio/<item>/v<n>/ (F6)
  status [--md docs/STATUS.md]                      per-jurisdiction readiness table (map, blueprint, authorities, items, mocks, phase)
  mock-build <XX> [--forms 5] [--status published]  assemble N non-overlapping full-length mocks in the state's format
`;

async function main() {
  switch (cmd) {
    case "ingest": {
      const [jur, citation, urlOrTitle, title] = positional;
      if (!jur || !citation) throw new Error("ingest <JUR> <citation> <url>|--file <path>");
      const file = flag("file");
      if (file) {
        const text = file.toLowerCase().endsWith(".pdf") ? await pdfToText(new Uint8Array(readFileSync(file))) : readFileSync(file, "utf8");
        const p = saveStatute({ jurisdiction: jur, citation, title: urlOrTitle ?? citation, url: flag("url") ?? null, fetched_on: today(), text });
        console.log(`saved ${p}`);
      } else {
        if (!urlOrTitle) throw new Error("need a url or --file");
        const p = await fetchStatute(jur, citation, urlOrTitle, title);
        console.log(`saved ${p}`);
      }
      break;
    }
    case "statutes": {
      for (const d of loadStatutes(positional[0]!)) console.log(`${d.citation.padEnd(40)} ${String(d.text.length).padStart(8)} chars  ${d.fetched_on}  ${d.url ?? "(manual)"}`);
      break;
    }
    case "plan": {
      const gaps = planBank(positional[0]!);
      console.log("node       exam  target  existing  gap   K/A/N            label");
      for (const g of gaps) console.log(`${g.node.padEnd(10)} ${String(g.exam_items).padEnd(5)} ${String(g.target_bank_items).padEnd(7)} ${String(g.existing).padEnd(9)} ${String(g.gap).padEnd(5)} ${`${g.byLevel.knowledge}/${g.byLevel.application}/${g.byLevel.analysis}`.padEnd(16)} ${g.label}`);
      const t = gaps.reduce((a, g) => ({ target: a.target + g.target_bank_items, existing: a.existing + g.existing }), { target: 0, existing: 0 });
      console.log(`\n${t.existing}/${t.target} items (${((100 * t.existing) / Math.max(1, t.target)).toFixed(0)}%)`);
      break;
    }
    case "draft": {
      const dryRun = rest.includes("--dry-run");
      if (BACKEND === "router" && !dryRun) {
        const r = await draftDirect(positional[0]!, { nodes: flag("nodes")?.split(","), limit: flag("limit") ? Number(flag("limit")) : undefined });
        console.log(`drafted ${r.written}/${r.requested} items (${r.failed} failed requests) → .pipeline/drafts/${positional[0]}/  providers: ${JSON.stringify(r.byProvider)}`);
        break;
      }
      const m = await submitDraftBatch(positional[0]!, { nodes: flag("nodes")?.split(","), limit: flag("limit") ? Number(flag("limit")) : undefined, dryRun });
      if (!dryRun) console.log(`submitted ${m.batch_id}: ${m.requests.length} requests, ${m.requests.reduce((a, r) => a + r.count, 0)} items requested`);
      break;
    }
    case "collect": { console.log(await collectBatch(positional[0]!)); break; }
    case "verify": {
      if (BACKEND === "router") { const r = await verifyDirect(positional[0]!); console.log(`verify: ${r.drafts} drafts → ${r.localRejected} rejected locally, ${r.verified} verified, ${r.rejected} rejected by verifier, ${r.failed} failed  providers: ${JSON.stringify(r.byProvider)}`); break; }
      const m = await submitVerifyBatch(positional[0]!); console.log(m ? `submitted ${m.batch_id}: ${m.requests.length} items` : "nothing to verify"); break;
    }
    case "collect-verify": { console.log(await collectVerifyBatch(positional[0]!)); break; }
    case "batches": {
      for (const p of listFiles(join(CONFIG.stateDir, "batches"), ".json")) { const m = readJson<any>(p); console.log(`${m.batch_id}  ${m.kind.padEnd(6)} ${m.bank.padEnd(20)} ${m.requests.length} reqs  ${m.created}`); }
      break;
    }
    case "keys": {
      const bank = positional[0]!;
      const items = loadItems(CONFIG.contentDir).items.map((x) => x.value).filter((i) => i.bank === bank && i.status !== "retired");
      const dist: Record<string, number> = {};
      for (const out of assignKeyPositions(items)) { writeYaml(join(CONFIG.contentDir, "items", bank, domainOf(out.blueprint_node), `${out.id}.yaml`), out); dist[out.key] = (dist[out.key] ?? 0) + 1; }
      console.log(`${items.length} items re-keyed`, dist);
      break;
    }
    case "balance": {
      const bank = positional[0]!;
      const jur = bank.startsWith("state_") ? bank.slice(6) : "NAT";
      const docs = loadStatutes(jur);
      const router = new LlmRouter(); router.log = (l) => console.log(l);
      const items = loadItems(CONFIG.contentDir).items.map((x) => x.value).filter((i) => i.bank === bank && i.status !== "retired" && needsBalancing(i));
      console.log(`${items.length} items need balancing`);
      let changed = 0;
      for (const it of items) {
        const hit = locateQuote(docs, it.citation.quoted_text);
        const excerpt = hit ? excerptAround(hit.doc.text, hit.index, 3000) : it.explanation;
        try {
          const b = await balanceItem(router, it, excerpt);
          if (!b.changed || !needsBalancing(it)) continue;
          const out: Item = { ...b.item, status: "verified", reviewer: null, qa_approved_on: null };
          writeYaml(join(CONFIG.contentDir, "items", bank, domainOf(out.blueprint_node), `${out.id}.yaml`), out);
          changed++; console.log(`  ${it.id}: ${b.rationale.slice(0, 120)}`);
        } catch (e) { console.log(`  ${it.id}: balance failed — ${String(e).slice(0, 120)}`); }
      }
      console.log(`${changed} items rebalanced → status verified (re-review with qa-packet)`);
      break;
    }
    case "requeue": {
      const { renameSync, readdirSync } = await import("node:fs");
      const bank = positional[0]!; const match = flag("match");
      const dir = join(CONFIG.stateDir, "rejected", bank); let n = 0;
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".yaml"))) {
        const d = readYaml<any>(join(dir, f));
        const reasons: string[] = d.rejection?.reasons ?? [];
        if (match && !reasons.some((r) => r.includes(match))) continue;
        delete d.rejection; d.status = "draft"; d.verified_on = null;
        writeYaml(join(CONFIG.stateDir, "drafts", bank, f), d);
        renameSync(join(dir, f), join(dir, f + ".requeued"));
        n++;
      }
      console.log(`${n} rejected drafts requeued for ${bank}`);
      break;
    }
    case "qa-packet": {
      const r = writeQaPackets(positional[0]!, { status: flag("status"), limit: flag("limit") ? Number(flag("limit")) : undefined, out: flag("out") ? join(repoRootDir(), flag("out")!) : undefined });
      console.log(`${r.count} packets → ${r.dir}/index.md`);
      break;
    }
    case "wait": {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic();
      const id = positional[0]!;
      const manifest = readJson<any>(join(CONFIG.stateDir, "batches", `${id}.json`));
      const started = Date.now();
      for (;;) {
        const b = await client.messages.batches.retrieve(id);
        const c = b.request_counts;
        console.log(`${new Date().toISOString()} ${b.processing_status} processing=${c.processing} succeeded=${c.succeeded} errored=${c.errored} expired=${c.expired}`);
        if (b.processing_status === "ended") break;
        if (Date.now() - started > 3 * 3600_000) throw new Error("gave up after 3h");
        await new Promise((r) => setTimeout(r, 60_000));
      }
      console.log(manifest.kind === "verify" ? await collectVerifyBatch(id) : await collectBatch(id));
      break;
    }
    case "qa-sheet": { qaSheet(positional[0]!, flag("sample") ? Number(flag("sample")) : 0.2); break; }
    case "qa-approve": { qaApprove(positional[0]!, positional.slice(1)); break; }
    case "node-brief": {
      const { writeNodeBriefs } = await import("./agentDraft.js");
      const r = writeNodeBriefs(positional[0]!, { nodes: flag("nodes")?.split(","), maxChars: flag("max-chars") ? Number(flag("max-chars")) : undefined });
      console.log(r.summary.join("\n")); console.log(`${r.files.length} briefs → ${r.files[0] ? r.files[0].replace(/[^/]+$/, "") : "(none)"}`); break;
    }
    case "import-drafts": {
      const { importDrafts } = await import("./agentDraft.js");
      const r = importDrafts(positional[0]!, positional[1]!);
      console.log(`written ${r.written.length}: ${r.written.join(" ")}`);
      for (const x of r.refused) console.log(`REFUSED [${x.node}] "${x.stem}…"\n  - ${x.reasons.join("\n  - ")}`);
      console.log(`refused ${r.refused.length}`); break;
    }
    case "verify-local": {
      const { verifyLocal } = await import("./agentDraft.js");
      const r = verifyLocal(positional[0]!); console.log(`verify-local: ${r.verified} verified (provisional), ${r.rejected} rejected`); break;
    }
    case "repair": { const { repairContentItems } = await import("./repair.js"); console.log(await repairContentItems(positional)); break; }
    case "qa-reject": { qaReject(positional[0]!, positional[1]!, positional[2] ?? "rejected by reviewer"); break; }
    case "refs-audit": {
      const rows = auditRefs(positional[0]);
      console.log(renderAudit(rows));
      if (rest.includes("--verbose")) for (const r of rows) if (r.unmatched.length || r.refs === 0) console.log(`  ${r.bank} ${r.node}: ${r.refs === 0 ? "NO REFS" : "unmatched → " + r.unmatched.join(" | ")}`);
      break;
    }
    case "glossary": { console.log(await buildGlossary(positional[0]!, { limit: flag("limit") ? Number(flag("limit")) : undefined })); break; }
    case "glossary-approve": { console.log(reviewGlossary(positional[0]!, "approved", positional[1]!, positional.slice(2)), "entries approved"); break; }
    case "glossary-reject": { console.log(reviewGlossary(positional[0]!, "rejected", positional[1]!, positional.slice(3), positional[2]), "entries rejected"); break; }
    case "audio-render": { console.log(await renderAudio(positional[0]!, { limit: flag("limit") ? Number(flag("limit")) : undefined, status: flag("status")?.split(",") as any })); break; }
    case "status": {
      const md = flag("md") ? writeStatusMarkdown(join(repoRootDir(), flag("md")!)) : renderStatus(computeStatus());
      console.log(md);
      break;
    }
    case "mock-build": {
      const r = buildMocks(positional[0]!, flag("forms") ? Number(flag("forms")) : 5, (flag("status") as any) ?? "published");
      if (Object.keys(r.shortfalls).length) {
        console.error("cannot build mocks — bank shortfalls (need = per-form count × forms):");
        for (const [bank, list] of Object.entries(r.shortfalls)) for (const s of list) console.error(`  ${bank} ${s.node}: need ${s.need}, have ${s.have}`);
        process.exit(2);
      }
      for (const p of r.written) console.log(`wrote ${p}`);
      break;
    }
    case "publish": {
      if (rest.includes("--remote")) {
        const r = await publishRemote({ bank: positional[0] ?? flag("bank"), dryRun: rest.includes("--dry-run"), forceVersion: rest.includes("--force-version"), backfill: rest.includes("--backfill"), log: (l) => console.log(l) });
        for (const w of r.warnings) console.warn(`warning: ${w}`);
        console.log(`${r.dry_run ? "[dry run] " : ""}uploaded ${r.uploaded} · unchanged ${r.skipped} · retired ${r.unpublished} · item_content rows ${r.content_rows} · alerts ${r.alerts} · version ${r.version ?? "(no new version)"}`);
        break;
      }
      if (!positional[0]) throw new Error("publish <bank> | publish --remote");
      const statuses = rest.includes("--include-verified") ? (["qa_approved", "verified"] as const) : (["qa_approved"] as const);
      console.log(`${publish(positional[0]!, [...statuses])} items published`);
      break;
    }
    case "forms-build": {
      if (!positional[0]) throw new Error("forms-build <national_pearsonvue|national_psi|XX> [--remote] [--forms N]");
      const r = await formsBuild(positional[0]!, { remote: rest.includes("--remote"), forms: flag("forms") ? Number(flag("forms")) : undefined, log: (l) => console.log(l) });
      for (const w of r.warnings) console.warn(`warning: ${w}`);
      console.log(`${r.target}: built ${r.built.length} form${r.built.length === 1 ? "" : "s"}, skipped ${r.skipped.length}${rest.includes("--remote") ? ` · upserted ${r.upserted} · retired ${r.retired}` : " (local only; add --remote to publish)"}`);
      break;
    }
    case "watch-sources": {
      const r = await watchSources({ bank: flag("bank"), dryRun: rest.includes("--dry-run"), skipBlocked: rest.includes("--skip-blocked"), concurrency: flag("concurrency") ? Number(flag("concurrency")) : undefined, log: (l) => console.log(l) });
      console.log("\n" + renderWatchSummary(r));
      break;
    }
    default: console.log(HELP); process.exit(cmd ? 1 : 0);
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
