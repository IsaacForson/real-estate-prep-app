import { describe, it, expect } from "vitest";
import {
  buildSyncPayload, toServerProgress, toServerSession, mergeServerProgress, mergeServerSessions,
  fromServerSession, wireJurisdiction, MAX_PROGRESS_ROWS, type ServerProgressRow, type ServerSessionRow,
} from "../lib/study/sync.js";
import { newProgress, applyAnswer } from "../lib/study/srs.js";
import type { Progress, StudySession } from "../lib/study/types.js";

const T0 = 1_800_000_000_000;
const UUID = "6f1a2b3c-4d5e-4f60-8a71-0b1c2d3e4f50";
const UUID2 = "7f1a2b3c-4d5e-4f60-8a71-0b1c2d3e4f51";

function session(over: Partial<StudySession> = {}): StudySession {
  return {
    id: UUID, kind: "practice", jurisdiction: "FL", banks: ["state_FL"], itemIds: ["pubA", "pubB"], position: 1,
    answers: { pubA: { itemId: "pubA", choice: "B", correct: true, at: T0 + 10, elapsedMs: 4200.6 } },
    startedAt: T0, endedAt: null, timeLimitMs: null, mockFormId: null, clientUpdatedAt: T0 + 20, ...over,
  };
}

describe("sync: local → wire", () => {
  it("maps a progress row to the server shape with iso timestamps", () => {
    const p = applyAnswer(newProgress("pubA", "state_FL", "1.1", T0), true, T0);
    expect(toServerProgress(p)).toEqual({
      public_id: "pubA", attempts: 1, correct: 1, last_answered_at: new Date(T0).toISOString(), box: "yellow",
      due_at: new Date(p.dueAt).toISOString(), client_updated_at: new Date(T0).toISOString(),
    });
  });
  it("maps a session, flattening answers to an array and mapping drill/review to practice", () => {
    const row = toServerSession(session({ kind: "drill" }));
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("practice");
    expect(row!.bank).toBe("state_FL");
    expect(row!.jurisdiction).toBe("FL");
    expect(row!.answers).toEqual([{ item_id: "pubA", choice: "B", correct: true, at: new Date(T0 + 10).toISOString(), elapsed_ms: 4201 }]);
    expect(row!.time_remaining_s).toBeNull();
    expect(row!.ended_at).toBeNull();
  });
  it("computes remaining clock for mocks and keeps pre-uuid sessions local", () => {
    const mock = toServerSession(session({ kind: "mock", timeLimitMs: 60 * 60_000, clientUpdatedAt: T0 + 10 * 60_000, mockFormId: "short" }));
    expect(mock!.kind).toBe("mock");
    expect(mock!.form_id).toBe("short");
    expect(mock!.time_remaining_s).toBe(50 * 60);
    expect(toServerSession(session({ id: "practice-abc123" }))).toBeNull();
  });
  it("derives a jurisdiction from the bank when the session has none", () => {
    expect(wireJurisdiction({ jurisdiction: "", banks: ["national_psi"] })).toBe("NAT");
    expect(wireJurisdiction({ jurisdiction: "", banks: ["state_TX"] })).toBe("TX");
    expect(wireJurisdiction({ jurisdiction: "", banks: [] })).toBeNull();
  });
});

describe("sync: payload", () => {
  it("includes only rows changed after the watermark, oldest first, deduped, and reports overflow", () => {
    const old = { ...newProgress("old", "state_FL", "1", T0 - 10), clientUpdatedAt: T0 - 10 };
    const a = { ...newProgress("a", "state_FL", "1", T0 + 5), clientUpdatedAt: T0 + 5 };
    const b = { ...newProgress("b", "state_FL", "1", T0 + 1), clientUpdatedAt: T0 + 1 };
    const payload = buildSyncPayload({ progress: [old, a, b], sessions: [session(), session({ id: "legacy-1" })], pushedAfter: T0, since: "2027-01-01T00:00:00.000Z" });
    expect(payload.progress.map((r) => r.public_id)).toEqual(["b", "a"]);
    expect(payload.study_sessions.map((r) => r.id)).toEqual([UUID]);
    expect(payload.since).toBe("2027-01-01T00:00:00.000Z");
    expect(payload.hasMore).toBe(false);
  });
  it("caps progress rows at the server maximum and flags hasMore", () => {
    const many: Progress[] = Array.from({ length: MAX_PROGRESS_ROWS + 5 }, (_, i) => ({ ...newProgress(`p${i}`, "state_FL", "1", T0 + i), clientUpdatedAt: T0 + i + 1 }));
    const payload = buildSyncPayload({ progress: many, sessions: [], pushedAfter: T0, since: null });
    expect(payload.progress).toHaveLength(MAX_PROGRESS_ROWS);
    expect(payload.hasMore).toBe(true);
  });
});

describe("sync: wire → local (last write wins)", () => {
  const serverRow = (over: Partial<ServerProgressRow> = {}): ServerProgressRow => ({
    public_id: "pubA", attempts: 3, correct: 2, last_answered_at: new Date(T0 + 500).toISOString(), box: "green",
    due_at: new Date(T0 + 600).toISOString(), client_updated_at: new Date(T0 + 500).toISOString(), leech: false, ...over,
  });
  it("applies server rows that are strictly newer and ignores older or equal ones", () => {
    const local = applyAnswer(newProgress("pubA", "state_FL", "1.1", T0), true, T0 + 100);
    const writes = mergeServerProgress(new Map([["pubA", local]]), [serverRow()]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ itemId: "pubA", bank: "state_FL", node: "1.1", attempts: 3, correct: 2, misses: 1, box: "green", clientUpdatedAt: T0 + 500 });
    expect(writes[0]!.history).toEqual(local.history); // server keeps none; ours survives
    expect(mergeServerProgress(new Map([["pubA", local]]), [serverRow({ client_updated_at: new Date(T0 + 100).toISOString() })])).toEqual([]);
    expect(mergeServerProgress(new Map([["pubA", local]]), [serverRow({ client_updated_at: new Date(T0 + 50).toISOString() })])).toEqual([]);
  });
  it("creates rows for items unknown locally using cached item metadata, and marks leeches", () => {
    const writes = mergeServerProgress(new Map(), [serverRow({ public_id: "pubZ", attempts: 6, correct: 1, leech: undefined })], (id) => (id === "pubZ" ? { bank: "national_psi", node: "IV.B" } : undefined));
    expect(writes[0]).toMatchObject({ itemId: "pubZ", bank: "national_psi", node: "IV.B", misses: 5, leech: true, streak: 2 });
  });
  it("keeps the newest of duplicate server rows and drops rows with unparsable timestamps", () => {
    const writes = mergeServerProgress(new Map(), [
      serverRow({ attempts: 1, client_updated_at: new Date(T0 + 1).toISOString() }),
      serverRow({ attempts: 2, client_updated_at: new Date(T0 + 2).toISOString() }),
      serverRow({ public_id: "bad", client_updated_at: "not a date" }),
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.attempts).toBe(2);
  });
  it("merges a newer server session onto the local one and rebuilds unknown sessions from answers", () => {
    const local = session();
    const server: ServerSessionRow = {
      ...toServerSession(local)!,
      position: 2,
      ended_at: new Date(T0 + 900).toISOString(),
      client_updated_at: new Date(T0 + 900).toISOString(),
      answers: [
        { item_id: "pubA", choice: "B", correct: true, at: new Date(T0 + 10).toISOString(), elapsed_ms: 4201 },
        { item_id: "pubB", choice: "C", correct: false, at: new Date(T0 + 800).toISOString(), elapsed_ms: 900 },
      ],
    };
    const [merged] = mergeServerSessions(new Map([[UUID, local]]), [server]);
    expect(merged).toBeDefined();
    expect(merged!.itemIds).toEqual(["pubA", "pubB"]); // local list kept
    expect(merged!.position).toBe(1); // clamped to the item list
    expect(merged!.endedAt).toBe(T0 + 900);
    expect(Object.keys(merged!.answers).sort()).toEqual(["pubA", "pubB"]);
    expect(merged!.answers.pubB).toMatchObject({ choice: "C", correct: false, at: T0 + 800, elapsedMs: 900 });

    const fresh = fromServerSession({ ...server, id: UUID2 }, undefined);
    expect(fresh.itemIds).toEqual(["pubA", "pubB"]); // rebuilt from answers, in answer order
    expect(fresh.banks).toEqual(["state_FL"]);
    expect(fresh.kind).toBe("practice");

    // stale server copy: nothing to write
    expect(mergeServerSessions(new Map([[UUID, local]]), [{ ...server, client_updated_at: new Date(T0).toISOString() }])).toEqual([]);
  });
});
