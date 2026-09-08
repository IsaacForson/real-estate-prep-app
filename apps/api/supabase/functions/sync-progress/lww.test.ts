import { assertEquals } from "@std/assert";
import {
  dedupeNewest,
  isNewer,
  mergeLww,
  type ProgressRow,
  validateProgressRow,
  validateStudySessionRow,
} from "../_shared/lww.ts";

const row = (public_id: string, client_updated_at: string, attempts = 1): ProgressRow => ({
  public_id,
  attempts,
  correct: 1,
  last_answered_at: client_updated_at,
  box: "yellow",
  due_at: null,
  client_updated_at,
});

Deno.test("isNewer is strict: equal timestamps keep the server row", () => {
  assertEquals(isNewer(row("a", "2026-01-01T00:00:01Z"), row("a", "2026-01-01T00:00:00Z")), true);
  assertEquals(isNewer(row("a", "2026-01-01T00:00:00Z"), row("a", "2026-01-01T00:00:00Z")), false);
  assertEquals(isNewer(row("a", "2025-12-31T23:59:59Z"), row("a", "2026-01-01T00:00:00Z")), false);
});

Deno.test("dedupeNewest keeps the newest row per key", () => {
  const out = dedupeNewest(
    [row("a", "2026-01-01T00:00:00Z", 1), row("a", "2026-01-01T00:00:05Z", 2), row("b", "2026-01-01T00:00:00Z")],
    (r) => r.public_id,
  );
  assertEquals(out.length, 2);
  assertEquals(out.find((r) => r.public_id === "a")?.attempts, 2);
});

Deno.test("mergeLww splits winners and stale", () => {
  const existing = [row("a", "2026-01-01T00:00:10Z", 5), row("b", "2026-01-01T00:00:00Z", 1)];
  const incoming = [
    row("a", "2026-01-01T00:00:05Z", 4),
    row("b", "2026-01-01T00:00:01Z", 2),
    row("c", "2026-01-01T00:00:00Z"),
  ];
  const { winners, stale } = mergeLww(existing, incoming, (r) => r.public_id);
  assertEquals(winners.map((r) => r.public_id).sort(), ["b", "c"]);
  assertEquals(stale.map((r) => r.public_id), ["a"]);
});

Deno.test("validateProgressRow rejects impossible rows", () => {
  const ok = validateProgressRow({
    public_id: "x1",
    attempts: 3,
    correct: 2,
    last_answered_at: null,
    box: "red",
    due_at: "2026-01-02T00:00:00Z",
    client_updated_at: "2026-01-01T00:00:00Z",
  });
  assertEquals(ok?.box, "red");
  assertEquals(
    validateProgressRow({
      public_id: "x1",
      attempts: 1,
      correct: 2,
      box: "red",
      client_updated_at: "2026-01-01T00:00:00Z",
    }),
    null,
  ); // correct > attempts
  assertEquals(
    validateProgressRow({
      public_id: "x1",
      attempts: 1,
      correct: 1,
      box: "blue",
      client_updated_at: "2026-01-01T00:00:00Z",
    }),
    null,
  ); // bad box
  assertEquals(
    validateProgressRow({ public_id: "x1", attempts: 1, correct: 1, box: "red", client_updated_at: "yesterday" }),
    null,
  ); // bad clock
  assertEquals(
    validateProgressRow({
      public_id: "",
      attempts: 1,
      correct: 1,
      box: "red",
      client_updated_at: "2026-01-01T00:00:00Z",
    }),
    null,
  );
  assertEquals(validateProgressRow(null), null);
});

Deno.test("validateStudySessionRow accepts a resumable mid-question session", () => {
  const s = validateStudySessionRow({
    id: "3f0b0a2e-6a57-4a1e-9b1a-1f4c3a2b1c00",
    kind: "mock",
    jurisdiction: "FL",
    bank: "state_FL",
    form_id: "A",
    started_at: "2026-01-01T00:00:00Z",
    ended_at: null,
    position: 37,
    answers: [{ public_id: "p1", choice: "B", correct: true }],
    time_remaining_s: 4210,
    client_updated_at: "2026-01-01T00:40:00Z",
  });
  assertEquals(s?.position, 37);
  assertEquals(s?.time_remaining_s, 4210);
  assertEquals(
    validateStudySessionRow({
      id: "not-a-uuid",
      kind: "mock",
      jurisdiction: "FL",
      started_at: "2026-01-01T00:00:00Z",
      position: 0,
      answers: [],
      client_updated_at: "2026-01-01T00:00:00Z",
    }),
    null,
  );
  assertEquals(
    validateStudySessionRow({
      id: "3f0b0a2e-6a57-4a1e-9b1a-1f4c3a2b1c00",
      kind: "quiz",
      jurisdiction: "FL",
      started_at: "2026-01-01T00:00:00Z",
      position: 0,
      answers: [],
      client_updated_at: "2026-01-01T00:00:00Z",
    }),
    null,
  );
});
