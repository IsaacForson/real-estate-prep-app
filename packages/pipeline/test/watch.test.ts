import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { normalizeForHash, textHash, sha256Hex } from "../src/hash.js";
import { splitSections, diffSections, affectedItems, itemCitesDoc, watchSources, isKnownBlocked, renderChangesSection } from "../src/watch.js";
import { saveStatute, parseStatuteFile, type StatuteDoc } from "../src/statutes.js";
import type { Item } from "@rep/schema";

const TILA_OLD = [
  "§1634. Other.", "", "Stuff about other things that do not matter here.", "",
  "§1635. Right of rescission", "", "(a) Disclosure of obligor's right to rescind", "",
  "Except as otherwise provided in this section, in the case of any consumer credit transaction the obligor shall have the right to rescind the transaction until midnight of the third business day following the consummation of the transaction.", "",
  "§1636. Repealed.", "", "Section 1636 was repealed.", "",
  "§1638. Transactions other than under an open end credit plan", "", "(a) Required disclosures by creditor", "", "For each consumer credit transaction other than under an open end credit plan, the creditor shall disclose each of the following items, to the extent applicable.",
].join("\n");
const TILA_NEW = TILA_OLD.replace("third business day", "fifth business day");

const doc = (text: string, extra: Partial<StatuteDoc> = {}): StatuteDoc => ({
  jurisdiction: "NAT", citation: "15 U.S.C. §§ 1601–1667f (TILA)", title: "Truth in Lending Act", url: "https://www.govinfo.gov/x/tila.htm", fetched_on: "2026-09-08", text, slug: "15-u-s-c-ss-1601-1667f-tila", ...extra,
});

const item = (id: string, source: string, quote: string, status: Item["status"] = "published"): Item => ({
  id, jurisdiction: "NAT", bank: "national_pearsonvue", blueprint_node: "VII.A", vendor: "pearsonvue", license_level: "both", cognitive_level: "knowledge",
  stem: "Under TILA, how long does a consumer have to rescind a qualifying credit transaction?", options: ["Three business days", "Five business days", "Ten business days", "Thirty days"], key: "A",
  explanation: "Section 1635 gives the obligor the right to rescind until midnight of the third business day following consummation, so three business days is the rule.",
  citation: { source, url: null, quoted_text: quote, secondary: [] }, terms: [], tags: [], status, reviewer: "qa-lead-model", verified_on: "2026-09-08", qa_approved_on: "2026-09-08", version: 1,
});

describe("hashing", () => {
  it("ignores whitespace/CRLF re-flow but not words", () => {
    expect(textHash("a  b\r\n\r\n\nc")).toBe(textHash("a b\nc"));
    expect(textHash("a b\nc")).not.toBe(textHash("a b\nd"));
    expect(normalizeForHash("  x \t y \n\n\n z ")).toBe("x y\nz");
    expect(sha256Hex("")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("section diff", () => {
  it("splits on statute headings and keeps the longest duplicate body", () => {
    const s = splitSections("§1635. Right of rescission\n§1636. Repealed.\n\n§1635. Right of rescission\n\nlong body here");
    expect([...s.keys()]).toEqual(["1635", "1636"]);
    expect(s.get("1635")).toContain("long body here");
  });
  it("reports changed, removed and added sections", () => {
    const d = diffSections(TILA_OLD, TILA_NEW);
    expect(d.changed).toEqual(["1635"]);
    expect(d.removed).toEqual([]);
    const d2 = diffSections(TILA_OLD, TILA_OLD.replace(/§1638[\s\S]*$/, "") + "§1640. Civil liability\n\nNew section.");
    expect(d2.removed).toEqual(["1638"]);
    expect(d2.added).toEqual(["1640"]);
  });
});

describe("affected items", () => {
  const old = doc(TILA_OLD);
  const quoting = item("NAT-PV-VII-0001", "15 U.S.C. § 1635(a)", "the obligor shall have the right to rescind the transaction until midnight of the third business day");
  const sameSectionOtherQuote = item("NAT-PV-VII-0002", "15 U.S.C. § 1635(a)", "Except as otherwise provided in this section, in the case of any consumer credit transaction");
  const otherSection = item("NAT-PV-VII-0003", "15 U.S.C. § 1638(a)", "the creditor shall disclose each of the following items, to the extent applicable");
  const otherDoc = item("NAT-PV-VII-0004", "12 U.S.C. § 2607(a)", "No person shall give and no person shall accept any fee, kickback, or thing of value");
  const items = [quoting, sameSectionOtherQuote, otherSection, otherDoc].map((value) => ({ file: `items/national_pearsonvue/VII/${value.id}.yaml`, value }));

  it("knows which items rest on a doc", () => {
    expect(itemCitesDoc(quoting, old)).toBe(true);
    expect(itemCitesDoc(otherDoc, old)).toBe(false);
  });
  it("flags a broken quote and a changed section slice, leaves untouched sections alone", () => {
    const hits = affectedItems(old, TILA_NEW, items);
    const byId = Object.fromEntries(hits.map((h) => [h.id, h.reasons]));
    expect(Object.keys(byId).sort()).toEqual(["NAT-PV-VII-0001", "NAT-PV-VII-0002"]);
    expect(byId["NAT-PV-VII-0001"]!.some((r) => r.includes("quoted_text no longer appears"))).toBe(true);
    expect(byId["NAT-PV-VII-0001"]!.some((r) => r.includes("section 1635 changed"))).toBe(true);
    expect(byId["NAT-PV-VII-0002"]).toEqual(["text of section 1635 changed"]);
  });
  it("flags a section that disappeared", () => {
    const hits = affectedItems(old, TILA_OLD.replace(/§1638[\s\S]*$/, ""), items);
    expect(hits.map((h) => h.id)).toEqual(["NAT-PV-VII-0003"]);
    expect(hits[0]!.reasons[1]).toMatch(/not found in the fetched text/);
  });
  it("skips drafts and retired items", () => {
    const hits = affectedItems(old, TILA_NEW, [{ file: "x", value: { ...quoting, status: "retired" } }, { file: "y", value: { ...quoting, status: "draft", reviewer: null, qa_approved_on: null } }]);
    expect(hits).toEqual([]);
  });
});

describe("watchSources end to end (fake fetcher)", () => {
  let root: string, content: string, state: string, docs: string;
  const itemFile = () => join(content, "items/national_pearsonvue/VII/NAT-PV-VII-0001.yaml");
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rep-watch-"));
    content = join(root, "content"); state = join(root, ".pipeline"); docs = join(root, "docs");
    mkdirSync(join(content, "statutes", "NAT"), { recursive: true });
    mkdirSync(docs, { recursive: true });
    // saveStatute writes under CONFIG.contentDir, so write the file by hand in the temp dir
    const d = doc(TILA_OLD);
    writeFileSync(join(content, "statutes/NAT", `${d.slug}.md`), `---\njurisdiction: "NAT"\ncitation: ${JSON.stringify(d.citation)}\ntitle: ${JSON.stringify(d.title)}\nurl: ${JSON.stringify(d.url)}\nfetched_on: "2026-09-08"\n---\n${TILA_OLD}\n`);
    mkdirSync(join(content, "items/national_pearsonvue/VII"), { recursive: true });
    writeFileSync(itemFile(), YAML.stringify(item("NAT-PV-VII-0001", "15 U.S.C. § 1635(a)", "the obligor shall have the right to rescind the transaction until midnight of the third business day")));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const run = (text: string | Error, dryRun = false, day = "2026-09-09") =>
    watchSources({ contentDir: content, stateDir: state, docsDir: docs, dryRun, today: day, fetcher: async () => { if (text instanceof Error) throw text; return text; } });

  it("records a baseline hash on first sight, then unchanged, then a change with affected items", async () => {
    const r1 = await run(TILA_OLD);
    expect(r1.summary).toMatchObject({ baseline: 1, changed: 0, docs: 1, sources: 1 });
    const parsed = parseStatuteFile(join(content, "statutes/NAT/15-u-s-c-ss-1601-1667f-tila.md"));
    expect(parsed.source_sha256).toBe(textHash(TILA_OLD));
    expect(parsed.text_sha256).toBe(textHash(TILA_OLD));
    expect(parsed.text.trim()).toBe(TILA_OLD.trim());
    expect(existsSync(join(state, "watch", "2026-09-09.json"))).toBe(true);
    expect(existsSync(join(state, "watch", "alerts.json"))).toBe(false);

    const r2 = await run(TILA_OLD + "\n\n\n", false, "2026-09-10");
    expect(r2.summary.unchanged).toBe(1);
    expect(parseStatuteFile(join(content, "statutes/NAT/15-u-s-c-ss-1601-1667f-tila.md")).checked_on).toBe("2026-09-10");

    const r3 = await run(TILA_NEW, false, "2026-09-11");
    expect(r3.summary).toMatchObject({ changed: 1, affected_items: 1 });
    const src = r3.sources[0]!;
    expect(src.sections!.changed).toEqual(["1635"]);
    expect(src.affected_items!.map((a) => a.id)).toEqual(["NAT-PV-VII-0001"]);
    // new version stored next to the cached text, cached text untouched
    const vPath = join(content, "statutes/NAT/_versions/15-u-s-c-ss-1601-1667f-tila/2026-09-11.md");
    expect(existsSync(vPath)).toBe(true);
    expect(parseStatuteFile(vPath).text).toContain("fifth business day");
    const cached = parseStatuteFile(join(content, "statutes/NAT/15-u-s-c-ss-1601-1667f-tila.md"));
    expect(cached.text).toContain("third business day");
    expect(cached.source_sha256).toBe(textHash(TILA_NEW));
    expect(cached.source_changed_on).toBe("2026-09-11");
    // item pulled to needs_review with a reason
    const y = YAML.parse(readFileSync(itemFile(), "utf8"));
    expect(y.status).toBe("needs_review");
    expect(y.review_reason).toMatch(/^2026-09-11: quoted_text no longer appears/);
    expect(y.options).toHaveLength(4);
    // alerts + docs
    const alerts = JSON.parse(readFileSync(join(state, "watch", "alerts.json"), "utf8"));
    expect(alerts.map((a: any) => a.kind).sort()).toEqual(["quote_broken", "source_changed"]);
    expect(alerts.find((a: any) => a.kind === "quote_broken")).toMatchObject({ jurisdiction: "NAT", ref: "NAT-PV-VII-0001" });
    const md = readFileSync(join(docs, "STATUTE_CHANGES.md"), "utf8");
    expect(md).toContain("## 2026-09-11");
    expect(md).toContain("NAT-PV-VII-0001");
    expect(md).toContain("Sections changed (1): 1635");

    // a second changed run the same day merges alerts without duplicating
    await run(TILA_NEW.replace("fifth", "sixth"), false, "2026-09-11");
    expect(JSON.parse(readFileSync(join(state, "watch", "alerts.json"), "utf8"))).toHaveLength(2);
  });

  it("dry run writes only the report", async () => {
    await run(TILA_OLD);
    const before = readFileSync(itemFile(), "utf8");
    const r = await run(TILA_NEW, true, "2026-09-12");
    expect(r.summary.changed).toBe(1);
    expect(r.dry_run).toBe(true);
    expect(readFileSync(itemFile(), "utf8")).toBe(before);
    expect(existsSync(join(content, "statutes/NAT/_versions"))).toBe(false);
    expect(existsSync(join(docs, "STATUTE_CHANGES.md"))).toBe(false);
    expect(existsSync(join(state, "watch", "alerts.json"))).toBe(false);
    expect(existsSync(join(state, "watch", "2026-09-12.dry-run.json"))).toBe(true);
  });

  it("notes fetch failures; unknown hosts alert, known-blocked hosts do not", async () => {
    const r = await run(new Error("ECONNRESET"));
    expect(r.summary.failed).toBe(1);
    expect(r.alerts).toEqual([expect.objectContaining({ kind: "fetch_failed", jurisdiction: "NAT" })]);
    expect(isKnownBlocked("https://statutes.capitol.texas.gov/Docs/OC/htm/OC.1101.htm")).toBe(true);
    expect(isKnownBlocked("https://www.govinfo.gov/x")).toBe(false);
  });

  it("filters to one bank's jurisdiction", async () => {
    const r = await watchSources({ contentDir: content, stateDir: state, docsDir: docs, bank: "state_TX", fetcher: async () => TILA_OLD });
    expect(r.summary.sources).toBe(0);
  });
});

describe("renderChangesSection", () => {
  it("lists source, sections and items", () => {
    const md = renderChangesSection("2026-09-09", [{ url: "https://x", jurisdiction: "TX", citations: ["Tex. Occ. Code ch. 1101"], slugs: ["s"], status: "changed", old_hash: "aaaaaaaaaaaaaaaa", new_hash: "bbbbbbbbbbbbbbbb", version: "2026-09-09", sections: { changed: ["1101.652"], removed: [], added: [] }, affected_items: [{ id: "TX-1101-0007", bank: "state_TX", file: "f", status: "published", reasons: ["text of section 1101.652 changed"] }] }], []);
    expect(md).toContain("### TX — Tex. Occ. Code ch. 1101");
    expect(md).toContain("TX-1101-0007");
    expect(md).toContain("Sections changed (1): 1101.652");
  });
});

// saveStatute is exercised by the pipeline itself; keep a smoke check that optional metadata round-trips
describe("statute metadata round-trip", () => {
  it("writes and reads hash fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "rep-meta-"));
    try {
      const prev = process.env.CONTENT_DIR;
      // saveStatute uses CONFIG (fixed at import); write via the same front-matter format instead
      const path = join(dir, "d.md");
      writeFileSync(path, `---\njurisdiction: "TX"\ncitation: "Tex. Occ. Code ch. 1101"\ntitle: "t"\nurl: "https://x"\nfetched_on: "2026-09-08"\nsource_sha256: "abc"\nchecked_on: "2026-09-09"\n---\nbody\n`);
      const d = parseStatuteFile(path);
      expect(d.source_sha256).toBe("abc");
      expect(d.checked_on).toBe("2026-09-09");
      expect(d.text_sha256).toBeUndefined();
      void prev; void saveStatute;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
