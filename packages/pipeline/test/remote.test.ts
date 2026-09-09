import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import type { Item } from "@rep/schema";
import { planPublish, emptyManifest, serializeItem, objectPath, indexRow, versionTag, SupabaseRemote, publishRemote, type RemoteManifest } from "../src/remote.js";
import { sha256Hex } from "../src/hash.js";

const item = (id: string, status: Item["status"], extra: Partial<Item> = {}): Item => ({
  id, jurisdiction: "NAT", bank: "national_pearsonvue", blueprint_node: "IV.B", vendor: "pearsonvue", license_level: "both", cognitive_level: "application",
  stem: "A broker receives an earnest money deposit on Friday. By when must it be deposited under the reference rule?", options: ["Next business day", "Three business days", "Ten days", "At closing"], key: "A",
  explanation: "The reference note says the deposit must be placed in the trust account no later than the end of the next business day following receipt, which rules out the longer periods.",
  citation: { source: "REP Ref. Brokerage Practice § 3.2", url: null, quoted_text: "no later than the end of the next business day following receipt of the funds", secondary: [] },
  terms: [], tags: [], status, reviewer: status === "verified" ? null : "qa-lead-model", verified_on: "2026-09-08", qa_approved_on: status === "verified" ? null : "2026-09-08", version: 1, ...extra,
});

describe("planPublish", () => {
  it("uploads qa_approved + published only, skips unchanged, retires vanished", () => {
    const a = item("NAT-PV-IV-0001", "published"), b = item("NAT-PV-IV-0002", "qa_approved"), c = item("NAT-PV-IV-0003", "verified"), d = item("NAT-PV-IV-0004", "needs_review");
    const manifest: RemoteManifest = emptyManifest();
    manifest.items[a.id] = { sha256: sha256Hex(serializeItem(a)), path: objectPath(a), row: indexRow(a), published_at: "x" };
    manifest.items[d.id] = { sha256: "old", path: objectPath(d), row: indexRow(d), published_at: "x" }; // was published, now needs_review
    manifest.items["NAT-PV-IV-0009"] = { sha256: "old", path: "items/national_pearsonvue/NAT-PV-IV-0009.json", row: { ...indexRow(a), item_id: "NAT-PV-IV-0009", status: "retired" }, published_at: "x" };
    const plan = planPublish([a, b, c, d], manifest);
    expect(plan.skipped).toEqual([a.id]);
    expect(plan.upload.map((u) => u.item.id)).toEqual([b.id]);
    expect(plan.upload[0]!.path).toBe("items/national_pearsonvue/NAT-PV-IV-0002.json");
    expect(plan.upload[0]!.row).toMatchObject({ item_id: b.id, status: "published", content_version: 1, blueprint_node: "IV.B" });
    expect(plan.unpublish.map((e) => e.row.item_id)).toEqual([d.id]); // already-retired rows are not re-sent
  });
  it("re-uploads when the body changed and honours a bank filter", () => {
    const a = item("NAT-PV-IV-0001", "published");
    const manifest = emptyManifest();
    manifest.items[a.id] = { sha256: sha256Hex(serializeItem(a)), path: objectPath(a), row: indexRow(a), published_at: "x" };
    const edited = { ...a, explanation: a.explanation + " Edited.", version: 2 };
    expect(planPublish([edited], manifest).upload.map((u) => u.row.content_version)).toEqual([2]);
    expect(planPublish([edited], manifest, "state_TX").upload).toEqual([]);
  });
  it("serialises options in stored order with the key", () => {
    const a = item("NAT-PV-IV-0001", "published");
    const parsed = JSON.parse(serializeItem(a));
    expect(parsed.options).toEqual(a.options);
    expect(parsed.key).toBe("A");
    expect(versionTag("2026-09-09", "abc1234", new Date("2026-09-09T03:12:00Z"))).toBe("2026-09-09T0312+abc1234");
  });
});

/** Records every request; tables listed in `missing` answer like PostgREST does for an unknown relation. */
function fakeSupabase(missing: string[] = []) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: any }[] = [];
  const fetchImpl = (async (input: any, init: any) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const body = headers["content-type"]?.includes("json") && init?.body ? JSON.parse(init.body) : init?.body;
    calls.push({ url, method: init?.method ?? "GET", headers, body });
    const table = url.match(/\/rest\/v1\/([a-z_]+)/)?.[1];
    if (table && missing.includes(table)) return new Response(JSON.stringify({ code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` }), { status: 404 });
    return new Response(null, { status: url.includes("/storage/") ? 200 : 201 });
  }) as unknown as typeof fetch;
  return { calls, remote: new SupabaseRemote("https://example.supabase.co", "service-key", fetchImpl) };
}

describe("publishRemote", () => {
  let root: string, content: string, state: string;
  const writeItem = (it: Item) => { const p = join(content, "items", it.bank, it.blueprint_node.split(".")[0]!, `${it.id}.yaml`); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, YAML.stringify(it)); };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rep-remote-")); content = join(root, "content"); state = join(root, ".pipeline");
    writeItem(item("NAT-PV-IV-0001", "published"));
    writeItem(item("NAT-PV-IV-0002", "qa_approved"));
    writeItem(item("NAT-PV-IV-0003", "verified"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("uploads objects, upserts the index, records a version and ships alerts; second run is a no-op", async () => {
    mkdirSync(join(state, "watch"), { recursive: true });
    writeFileSync(join(state, "watch", "alerts.json"), JSON.stringify([{ kind: "source_changed", jurisdiction: "TX", ref: "Tex. Occ. Code ch. 1101", detail: { url: "https://x" } }]));
    const { calls, remote } = fakeSupabase();
    const r = await publishRemote({ contentDir: content, stateDir: state, remote, gitSha: "abc1234", today: "2026-09-09" });
    expect(r).toMatchObject({ uploaded: 2, skipped: 0, unpublished: 0, alerts: 1, version: expect.stringMatching(/^2026-09-09T\d{4}\+abc1234$/), warnings: [] });

    const uploads = calls.filter((c) => c.url.includes("/storage/v1/object/content/"));
    expect(uploads.map((c) => c.url.split("/object/content/")[1]).sort()).toEqual(["items/national_pearsonvue/NAT-PV-IV-0001.json", "items/national_pearsonvue/NAT-PV-IV-0002.json"]);
    expect(uploads[0]!.headers["x-upsert"]).toBe("true");
    expect(uploads[0]!.headers["authorization"]).toBe("Bearer service-key");
    expect(uploads[0]!.body.options).toHaveLength(4);

    const index = calls.find((c) => c.url.endsWith("/rest/v1/item_index"))!;
    expect(index.headers["prefer"]).toContain("merge-duplicates");
    expect(index.body.map((r: any) => r.item_id).sort()).toEqual(["NAT-PV-IV-0001", "NAT-PV-IV-0002"]);
    expect(index.body.every((r: any) => r.status === "published")).toBe(true);

    const version = calls.find((c) => c.url.endsWith("/rest/v1/content_versions"))!;
    expect(version.body[0]).toMatchObject({ version: expect.stringMatching(/^2026-09-09T\d{4}\+abc1234$/), item_count: 2 });
    expect(version.body[0].notes).toContain("2 uploaded");

    const alerts = calls.find((c) => c.url.endsWith("/rest/v1/content_alerts"))!;
    expect(alerts.body[0]).toMatchObject({ kind: "source_changed", jurisdiction: "TX", status: "open" });
    expect(existsSync(join(state, "watch", "alerts.json"))).toBe(false);
    expect(readdirSync(join(state, "watch")).some((f) => f.endsWith(".sent.json"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(state, "publish", "remote-manifest.json"), "utf8"));
    expect(Object.keys(manifest.items).sort()).toEqual(["NAT-PV-IV-0001", "NAT-PV-IV-0002"]);

    // second run: nothing to do, no version row
    const { calls: calls2, remote: remote2 } = fakeSupabase();
    const r2 = await publishRemote({ contentDir: content, stateDir: state, remote: remote2, gitSha: "abc1234", today: "2026-09-10" });
    expect(r2).toMatchObject({ uploaded: 0, skipped: 2, unpublished: 0, version: null });
    expect(calls2).toEqual([]);
  });

  it("retires items that dropped out of the publishable set", async () => {
    const { remote } = fakeSupabase();
    await publishRemote({ contentDir: content, stateDir: state, remote, gitSha: "a", today: "2026-09-09" });
    const pulled = item("NAT-PV-IV-0002", "needs_review", { review_reason: "2026-09-10: text of section 3.2 changed" });
    writeItem(pulled);
    const { calls, remote: remote2 } = fakeSupabase();
    const r = await publishRemote({ contentDir: content, stateDir: state, remote: remote2, gitSha: "b", today: "2026-09-10" });
    expect(r).toMatchObject({ uploaded: 0, skipped: 1, unpublished: 1, version: expect.stringMatching(/^2026-09-10T\d{4}\+b$/) });
    const index = calls.find((c) => c.url.endsWith("/rest/v1/item_index"))!;
    expect(index.body).toEqual([expect.objectContaining({ item_id: "NAT-PV-IV-0002", status: "retired" })]);
    const manifest = JSON.parse(readFileSync(join(state, "publish", "remote-manifest.json"), "utf8"));
    expect(manifest.items["NAT-PV-IV-0002"].row.status).toBe("retired");
    expect(calls.find((c) => c.url.endsWith("/rest/v1/content_versions"))!.body[0].item_count).toBe(1);
  });

  it("tolerates missing content_versions / content_alerts tables with warnings and keeps alerts", async () => {
    mkdirSync(join(state, "watch"), { recursive: true });
    writeFileSync(join(state, "watch", "alerts.json"), JSON.stringify([{ kind: "fetch_failed", jurisdiction: "NV", ref: "NRS 645", detail: {} }]));
    const { remote } = fakeSupabase(["content_versions", "content_alerts"]);
    const r = await publishRemote({ contentDir: content, stateDir: state, remote, gitSha: "a", today: "2026-09-09" });
    expect(r.uploaded).toBe(2);
    expect(r.version).toBeNull();
    expect(r.alerts).toBe(0);
    expect(r.warnings.join("\n")).toMatch(/content_versions table not found/);
    expect(r.warnings.join("\n")).toMatch(/content_alerts table not found/);
    expect(existsSync(join(state, "watch", "alerts.json"))).toBe(true);
  });

  it("dry run touches nothing remote and writes no manifest", async () => {
    const { calls, remote } = fakeSupabase();
    const r = await publishRemote({ contentDir: content, stateDir: state, remote, dryRun: true, gitSha: "a", today: "2026-09-09" });
    expect(r).toMatchObject({ uploaded: 2, dry_run: true });
    expect(calls).toEqual([]);
    expect(existsSync(join(state, "publish", "remote-manifest.json"))).toBe(false);
  });

  it("surfaces a real upload failure and still saves progress", async () => {
    let n = 0;
    const fetchImpl = (async (input: any) => { n++; if (String(input).includes("NAT-PV-IV-0002")) return new Response("boom", { status: 500 }); return new Response(null, { status: 200 }); }) as unknown as typeof fetch;
    const remote = new SupabaseRemote("https://example.supabase.co", "k", fetchImpl);
    await expect(publishRemote({ contentDir: content, stateDir: state, remote, gitSha: "a" })).rejects.toThrow(/storage upload .*0002.* 500/);
    const manifest = JSON.parse(readFileSync(join(state, "publish", "remote-manifest.json"), "utf8"));
    expect(Object.keys(manifest.items)).toEqual(["NAT-PV-IV-0001"]);
    expect(n).toBeGreaterThan(0);
  });
});
