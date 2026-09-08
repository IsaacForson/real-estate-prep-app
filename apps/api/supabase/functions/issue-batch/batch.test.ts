import { assert, assertEquals } from "@std/assert";
import {
  type Candidate,
  clampBatchSize,
  interleaveByNode,
  orderDue,
  seededRng,
  selectBatchItems,
} from "../_shared/batch.ts";
import { BATCH_DEFAULT, BATCH_MAX, BATCH_MIN } from "../_shared/limits.ts";

const due = (id: string, box: Candidate["box"], dueAt: string): Candidate => ({
  item_id: id,
  blueprint_node: "IV.B",
  cognitive_level: "knowledge",
  source: "due",
  box,
  due_at: dueAt,
});
const fresh = (id: string, node: string): Candidate => ({
  item_id: id,
  blueprint_node: node,
  cognitive_level: "application",
  source: "new",
  box: null,
  due_at: null,
});

Deno.test("clampBatchSize respects SPEC 50-200 and the free-tier cap", () => {
  assertEquals(clampBatchSize(undefined), BATCH_DEFAULT);
  assertEquals(clampBatchSize(10), BATCH_MIN);
  assertEquals(clampBatchSize(10_000), BATCH_MAX);
  assertEquals(clampBatchSize(120), 120);
  assertEquals(clampBatchSize(120, { cap: 17 }), 17); // free tier: below min is allowed
  assertEquals(clampBatchSize(120, { cap: 0 }), 0);
  assertEquals(clampBatchSize("abc"), BATCH_DEFAULT);
});

Deno.test("orderDue puts red before yellow before green, oldest first", () => {
  const out = orderDue([
    due("g", "green", "2026-01-01T00:00:00Z"),
    due("y2", "yellow", "2026-01-02T00:00:00Z"),
    due("r", "red", "2026-01-03T00:00:00Z"),
    due("y1", "yellow", "2026-01-01T00:00:00Z"),
  ]).map((c) => c.item_id);
  assertEquals(out, ["r", "y1", "y2", "g"]);
});

Deno.test("interleaveByNode does not front-load a single node", () => {
  const items = [
    ...Array.from({ length: 6 }, (_, i) => fresh(`a${i}`, "I.A")),
    ...Array.from({ length: 3 }, (_, i) => fresh(`b${i}`, "II.B")),
  ];
  const out = interleaveByNode(items, seededRng(7));
  // in the first 6 picks both nodes must appear at least twice.
  const head = out.slice(0, 6).map((c) => c.blueprint_node);
  assert(head.filter((n) => n === "II.B").length >= 2);
  assertEquals(out.length, 9);
});

Deno.test("selectBatchItems: due first, then fresh, exact size, no duplicates", () => {
  const dues = [due("d1", "red", "2026-01-01T00:00:00Z"), due("d2", "yellow", "2026-01-01T00:00:00Z")];
  const freshes = Array.from({ length: 10 }, (_, i) => fresh(`f${i}`, i % 2 ? "I.A" : "I.B"));
  const sel = selectBatchItems({ due: dues, fresh: freshes, canaries: [], size: 5, rng: seededRng(1) });
  assertEquals(sel.item_ids.length, 5);
  assertEquals(sel.item_ids.slice(0, 2), ["d1", "d2"]);
  assertEquals(sel.due_count, 2);
  assertEquals(sel.new_count, 3);
  assertEquals(new Set(sel.item_ids).size, 5);
});

Deno.test("selectBatchItems: canary is inserted without growing the batch, only when large enough", () => {
  const freshes = Array.from({ length: 60 }, (_, i) => fresh(`f${i}`, `N${i % 5}`));
  const big = selectBatchItems({
    due: [],
    fresh: freshes,
    canaries: ["CAN-0123456789abcdef"],
    size: 50,
    rng: seededRng(3),
  });
  assertEquals(big.item_ids.length, 50);
  assertEquals(big.canary_count, 1);
  assert(big.item_ids.includes("CAN-0123456789abcdef"));
  assertEquals(big.new_count + big.canary_count, 50);

  const small = selectBatchItems({
    due: [],
    fresh: freshes.slice(0, 10),
    canaries: ["CAN-0123456789abcdef"],
    size: 10,
    rng: seededRng(3),
  });
  assertEquals(small.canary_count, 0);
  assert(!small.item_ids.includes("CAN-0123456789abcdef"));
});

Deno.test("selectBatchItems: returns fewer than size when the scope is exhausted", () => {
  const sel = selectBatchItems({ due: [], fresh: [fresh("only", "I.A")], canaries: [], size: 50 });
  assertEquals(sel.item_ids, ["only"]);
});
