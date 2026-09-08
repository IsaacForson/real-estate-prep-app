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

const fixturesPath = resolve(here, "../fixtures/items.dev.yaml");
const fixtures: unknown[] = existsSync(fixturesPath) ? YAML.parse(readFileSync(fixturesPath, "utf8")) : [];
const fixtureItems = fixtures.map((f) => Item.parse(f));

const live = items.map((x) => x.value).filter((i) => i.status !== "draft" && i.status !== "retired");
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
};
writeFileSync(resolve(serverAssets, "manifest.json"), JSON.stringify(manifest)); // served by /api/manifest
writeFileSync(resolve(out, "items.json"), JSON.stringify(allItems));
console.log(`manifest: ${states.length} states, ${blueprints.length} blueprints; items.json: ${live.length} content items + ${fixtureItems.length} fixtures`);
