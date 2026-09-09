/**
 * Builds public/content/manifest.json (states, blueprints, per-bank status) and public/content/items.json
 * (all verified/published items from the content repo + dev fixtures) for the static ItemSource.
 * Production ships items via the API in signed batches instead (SPEC §5.4).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { loadStates, loadBlueprints, loadItems } from "@rep/content-lint";
import { Item, nodeTargets } from "@rep/schema";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const content = resolve(root, "content");
const out = resolve(here, "../public/content");
const serverAssets = resolve(here, "../server/assets/content");
mkdirSync(out, { recursive: true });
mkdirSync(serverAssets, { recursive: true });

const { states } = loadStates(content);
const { blueprints } = loadBlueprints(content);
const { items } = loadItems(content);

// Glossary (F16): content/glossary/<bank>.yaml → merged list with bank tags. Audio (F6): which item versions have assets.
import { readdirSync } from "node:fs";
const glossaryDir = resolve(content, "glossary");
const glossary: Array<{ term: string; definition: string; source: string; quoted_text: string; related_terms: string[]; items: string[]; bank: string }> = [];
if (existsSync(glossaryDir)) for (const f of readdirSync(glossaryDir).filter((f) => f.endsWith(".yaml"))) {
  const g = YAML.parse(readFileSync(resolve(glossaryDir, f), "utf8")) as { bank: string; entries: any[] };
  for (const e of g.entries) if (e.status === "approved") glossary.push({ term: e.term, definition: e.definition, source: e.source, quoted_text: e.quoted_text, related_terms: e.related_terms ?? [], items: e.items ?? [], bank: g.bank });
}
const audioDir = resolve(content, "audio");
const audio: Record<string, number> = {};
if (existsSync(audioDir)) for (const id of readdirSync(audioDir)) { const vs = readdirSync(resolve(audioDir, id)).filter((v) => /^v\d+$/.test(v) && existsSync(resolve(audioDir, id, v, "manifest.json"))); if (vs.length) audio[id] = Math.max(...vs.map((v) => Number(v.slice(1)))); }

const fixturesPath = resolve(here, "../fixtures/items.dev.yaml");
const fixtures: unknown[] = existsSync(fixturesPath) ? YAML.parse(readFileSync(fixturesPath, "utf8")) : [];
const fixtureItems = fixtures.map((f) => Item.parse(f));

const live = items.map((x) => x.value).filter((i) => i.status !== "draft" && i.status !== "retired" && i.status !== "needs_review");
const allItems = [...live, ...fixtureItems];

const statusFor = (bank: string) => {
  const bp = blueprints.find((b) => b.value.id === bank)?.value;
  const mine = allItems.filter((i) => i.bank === bank);
  const target = bp ? nodeTargets(bp).reduce((a, t) => a + t.target_bank_items, 0) : 0;
  const verified = mine.filter((i) => i.status === "verified" || i.status === "qa_approved").length;
  const published = mine.filter((i) => i.status === "published").length;
  const mocksDir = resolve(content, "mocks", bank.replace("state_", ""));
  const mocks = existsSync(mocksDir) ? 5 : 0; // count real forms when they exist
  const phase = published >= target && target > 0 ? "complete" : verified + published > 0 ? "in production" : bp ? "blueprinted" : "planned";
  return { code: bank.replace("state_", ""), phase, verified, published, target, mocks };
};

const manifest = {
  generated: new Date().toISOString(),
  states: Object.fromEntries(states.map((s) => [s.value.code, s.value])),
  blueprints: Object.fromEntries(blueprints.map((b) => [b.value.id, b.value])),
  status: Object.fromEntries(states.map((s) => [s.value.code, statusFor(`state_${s.value.code}`)])),
  nationalStatus: { national_pearsonvue: statusFor("national_pearsonvue"), national_psi: statusFor("national_psi") },
  glossary,
  audio,
};
writeFileSync(resolve(serverAssets, "manifest.json"), JSON.stringify(manifest)); // served by /api/manifest
writeFileSync(resolve(out, "items.json"), JSON.stringify(allItems));
// dev only: expose rendered audio under public/content/audio so StaticItemSource mode can play it
if (existsSync(audioDir)) { const { cpSync } = await import("node:fs"); cpSync(audioDir, resolve(out, "audio"), { recursive: true }); }
console.log(`manifest: ${states.length} states, ${glossary.length} glossary terms, ${Object.keys(audio).length} items with audio; , ${blueprints.length} blueprints; items.json: ${live.length} content items + ${fixtureItems.length} fixtures`);
