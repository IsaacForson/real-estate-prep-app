import { assert, assertEquals } from "@std/assert";
import { type BatchItemRef, StorageContentStore } from "../_shared/content-store.ts";
import type { Db } from "../_shared/db.ts";
import { shapeAvailability } from "../_shared/availability.ts";
import { formPortions, type MockFormRow, pickFormRow, truncatePortions } from "../_shared/mock.ts";

const doc = (id: string, source: string) => ({
  id,
  jurisdiction: "NAT",
  bank: "national_pearsonvue",
  blueprint_node: "IV.B",
  cognitive_level: "application",
  license_level: "both",
  stem: `stem of ${id} from ${source}`,
  options: ["a", "b", "c", "d"],
  key: "A",
  explanation: "because",
  citation: { source: "REP Ref.", url: null, quoted_text: "q" },
  terms: [],
  version: 1,
});

/**
 * Minimal supabase-js stand-in: item_index / item_content tables answer `.select().in()`, the
 * storage bucket answers download / upload. Every download is recorded so a test can prove the
 * bucket was (not) touched.
 */
function fakeDb(o: { index: string[]; table: Record<string, unknown>; bucket: Record<string, unknown>; tableError?: string }) {
  const downloads: string[] = [];
  const uploads: { path: string; body: string }[] = [];
  const from = (table: string) => ({
    select: (_cols: string) => ({
      in: (_col: string, ids: string[]) => {
        if (table === "item_index") {
          return Promise.resolve({ data: ids.filter((id) => o.index.includes(id)).map((id) => ({ item_id: id, bank: "national_pearsonvue" })), error: null });
        }
        if (table === "item_content") {
          if (o.tableError) return Promise.resolve({ data: null, error: { message: o.tableError } });
          return Promise.resolve({ data: ids.filter((id) => id in o.table).map((id) => ({ item_id: id, body: o.table[id] })), error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
    }),
  });
  const storage = {
    from: (_bucket: string) => ({
      download: (path: string) => {
        downloads.push(path);
        const id = path.split("/").pop()!.replace(/\.json$/, "");
        const body = o.bucket[id];
        if (body === undefined) return Promise.resolve({ data: null, error: { message: "not found" } });
        return Promise.resolve({ data: new Blob([JSON.stringify(body)]), error: null });
      },
      upload: (path: string, body: Blob) => body.text().then((text) => {
        uploads.push({ path, body: text });
        return { error: null };
      }),
      createSignedUrl: (path: string) => Promise.resolve({ data: { signedUrl: `https://signed/${path}` }, error: null }),
    }),
  };
  return { db: { from, storage } as unknown as Db, downloads, uploads };
}

const refs: BatchItemRef[] = [
  { item_id: "NAT-PV-IV-0001", public_id: "p1" },
  { item_id: "NAT-PV-IV-0002", public_id: "p2" },
  { item_id: "NAT-PV-IV-0003", public_id: "p3" },
];

Deno.test("buildBatch reads item_content first and only falls back to the bucket for ids missing from the table", async () => {
  const f = fakeDb({
    index: refs.map((r) => r.item_id),
    table: { "NAT-PV-IV-0001": doc("NAT-PV-IV-0001", "table"), "NAT-PV-IV-0002": doc("NAT-PV-IV-0002", "table") },
    bucket: { "NAT-PV-IV-0001": doc("NAT-PV-IV-0001", "bucket"), "NAT-PV-IV-0003": doc("NAT-PV-IV-0003", "bucket") },
  });
  const store = new StorageContentStore(f.db, "batches", "content", false);
  const built = await store.buildBatch("user", "batch-1", refs);
  assertEquals(built.included.map((r) => r.public_id), ["p1", "p2", "p3"]);
  assertEquals(built.missing, []);
  // only the id the table did not have went to storage
  assertEquals(f.downloads, ["items/national_pearsonvue/NAT-PV-IV-0003.json"]);
  const uploaded = JSON.parse(f.uploads[0]!.body) as { items: { public_id: string; stem: string }[]; missing: string[] };
  assertEquals(uploaded.items.map((i) => i.public_id), ["p1", "p2", "p3"]);
  assert(uploaded.items[0]!.stem.includes("from table"));
  assert(uploaded.items[2]!.stem.includes("from bucket"));
  // real ids never reach the document
  assertEquals(f.uploads[0]!.body.includes("NAT-PV-IV-0001\""), false);
});

Deno.test("buildBatch falls back to the bucket for everything when the table read fails, and reports what neither has", async () => {
  const f = fakeDb({
    index: refs.map((r) => r.item_id),
    table: {},
    tableError: "relation item_content does not exist",
    bucket: { "NAT-PV-IV-0001": doc("NAT-PV-IV-0001", "bucket") },
  });
  const store = new StorageContentStore(f.db, "batches", "content", false);
  const built = await store.buildBatch("user", "batch-2", refs);
  assertEquals(built.included.map((r) => r.public_id), ["p1"]);
  assertEquals(built.missing.map((r) => r.public_id).sort(), ["p2", "p3"]);
  assertEquals(f.downloads.length, 3);
});

Deno.test("buildBatch treats an unusable table body as missing there and still tries the bucket", async () => {
  const f = fakeDb({
    index: ["NAT-PV-IV-0001"],
    table: { "NAT-PV-IV-0001": { stem: "", options: ["only", "two"] } },
    bucket: { "NAT-PV-IV-0001": doc("NAT-PV-IV-0001", "bucket") },
  });
  const store = new StorageContentStore(f.db, "batches", "content", false);
  const built = await store.buildBatch("user", "batch-3", [refs[0]!]);
  assertEquals(built.included.length, 1);
  assertEquals(f.downloads.length, 1);
});

Deno.test("availability: a state bank names its national fallback, a national bank names none, nothing is invented", () => {
  assertEquals(shapeAvailability("state_FL", 0, "national_pearsonvue"), {
    bank: "state_FL",
    items_available: 0,
    fallback_bank: "national_pearsonvue",
  });
  assertEquals(shapeAvailability("state_GA", 7, "national_psi"), { bank: "state_GA", items_available: 7, fallback_bank: "national_psi" });
  assertEquals(shapeAvailability("national_pearsonvue", 118, "national_pearsonvue"), {
    bank: "national_pearsonvue",
    items_available: 118,
    fallback_bank: null,
  });
  assertEquals(shapeAvailability("state_TX", -3, "national_pearsonvue").items_available, 0);
});

const row = (over: Partial<MockFormRow>): MockFormRow => ({
  id: "national_pearsonvue:NAT:short",
  bank: "national_pearsonvue",
  jurisdiction: null,
  form_id: "short",
  title: "Short national mock",
  item_ids: ["n1", "n2", "n3", "n4"],
  time_limit_s: 1800,
  pass_score: 0.75,
  portions: [],
  status: "active",
  ...over,
});

Deno.test("pickFormRow prefers the state's own form, then the vendor's national form, else null", () => {
  const nat = row({});
  const psi = row({ id: "national_psi:NAT:short", bank: "national_psi" });
  const fl = row({ id: "state_FL:FL:short", bank: "state_FL", jurisdiction: "FL", item_ids: ["n1", "s1"] });
  assertEquals(pickFormRow([nat, psi, fl], "FL", "national_pearsonvue")?.id, fl.id);
  assertEquals(pickFormRow([nat, psi], "FL", "national_pearsonvue")?.id, nat.id);
  assertEquals(pickFormRow([nat, psi], "GA", "national_psi")?.id, psi.id);
  assertEquals(pickFormRow([row({ status: "retired" })], "FL", "national_pearsonvue"), null);
  assertEquals(pickFormRow([], "FL", "national_pearsonvue"), null);
});

Deno.test("formPortions reads the pipeline's portions and infers one from the bank otherwise; truncatePortions keeps the split", () => {
  const withPortions = row({
    item_ids: ["n1", "n2", "n3", "s1", "s2"],
    portions: [
      { portion: "national", bank: "national_pearsonvue", item_ids: ["n1", "n2", "n3"], pass_score: "70%" },
      { portion: "state", bank: "state_FL", item_ids: ["s1", "s2"], pass_score: "75%" },
    ],
  });
  const ps = formPortions(withPortions);
  assertEquals(ps.map((p) => [p.portion, p.item_ids.length, p.pass_score]), [["national", 3, "70%"], ["state", 2, "75%"]]);
  assertEquals(formPortions(row({}))[0], { portion: "national", bank: "national_pearsonvue", item_ids: ["n1", "n2", "n3", "n4"], pass_score: null });
  const cut = truncatePortions(ps, 3);
  assertEquals(cut.map((p) => p.item_ids), [["n1", "n2"], ["s1"]]);
  assertEquals(truncatePortions(ps, 99), ps);
});
