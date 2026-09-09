import { describe, it, expect } from "vitest";
import { MemoryCache, OWNER_KV_KEY } from "../lib/state/cache.js";
import { StudyRepo, ACTIVE_SESSION_KV, SYNC_SINCE_KV } from "../lib/state/repo.js";
import type { RemoteStore } from "../lib/state/remote.js";
import type { StudyStateRow, WireEvent } from "../lib/state/types.js";
import type { ServerProgressRow, ServerSessionRow, SyncPayload, SyncResponse } from "../lib/study/sync.js";
import { newProgress, applyAnswer } from "../lib/study/srs.js";
import type { StudySession } from "../lib/study/types.js";

const T0 = 1_800_000_000_000;
const UUID = "6f1a2b3c-4d5e-4f60-8a71-0b1c2d3e4f50";
const iso = (ms: number) => new Date(ms).toISOString();

/** In-memory server: stores rows with the same LWW rule as the database triggers. */
class FakeRemote implements RemoteStore {
  progress = new Map<string, ServerProgressRow>();
  sessions = new Map<string, ServerSessionRow>();
  studyState: StudyStateRow | null = null;
  events: WireEvent[] = [];
  calls: SyncPayload[] = [];
  offline = false;
  clock = T0 + 1_000_000;

  async sync(payload: SyncPayload): Promise<SyncResponse> {
    if (this.offline) throw new TypeError("Failed to fetch");
    this.calls.push(payload);
    let applied = 0, stale = 0;
    for (const r of payload.progress) {
      const cur = this.progress.get(r.public_id);
      if (!cur || Date.parse(r.client_updated_at) > Date.parse(cur.client_updated_at)) { this.progress.set(r.public_id, { ...r, updated_at: iso(this.clock) }); applied++; } else stale++;
    }
    for (const s of payload.study_sessions) {
      const cur = this.sessions.get(s.id);
      if (!cur || Date.parse(s.client_updated_at) > Date.parse(cur.client_updated_at)) this.sessions.set(s.id, { ...s, updated_at: iso(this.clock) });
    }
    const since = payload.since ? Date.parse(payload.since) : -Infinity;
    const pull = <T extends { updated_at?: string }>(rows: Iterable<T>) => [...rows].filter((r) => Date.parse(r.updated_at!) > since);
    return {
      server_time: iso(this.clock),
      progress: { applied, skipped_stale: stale, unknown_id: 0, invalid: 0, unknown_ids: [] },
      study_sessions: { applied: payload.study_sessions.length, rejected: [] },
      server: { progress: pull(this.progress.values()), study_sessions: pull(this.sessions.values()) },
      anomaly_flags_opened: [],
      reverification_requested: false,
    };
  }
  async getStudyState() { if (this.offline) throw new TypeError("Failed to fetch"); return this.studyState; }
  async putStudyState(row: StudyStateRow) {
    if (this.offline) throw new TypeError("Failed to fetch");
    if (!this.studyState || Date.parse(row.updated_at) > Date.parse(this.studyState.updated_at)) this.studyState = { ...row };
    return this.studyState;
  }
  async trackEvents(events: WireEvent[]) { if (this.offline) throw new TypeError("Failed to fetch"); this.events.push(...events); }
}

function setup(o: { remote?: FakeRemote | null; online?: () => boolean; now?: () => number } = {}) {
  const cache = new MemoryCache();
  const remote = o.remote === undefined ? new FakeRemote() : o.remote;
  const repo = new StudyRepo({ cache, remote: () => remote, online: o.online, now: o.now ?? (() => T0 + 500) });
  return { cache, remote, repo };
}

function session(over: Partial<StudySession> = {}): StudySession {
  return { id: UUID, kind: "practice", jurisdiction: "FL", banks: ["state_FL"], itemIds: ["pubA", "pubB"], position: 0, answers: {}, startedAt: T0, endedAt: null, timeLimitMs: null, mockFormId: null, clientUpdatedAt: T0 + 20, ...over };
}

describe("repo: writes go to the cache and the outbox", () => {
  it("queues progress and sessions, then replays them on flush and clears the outbox", async () => {
    const { cache, remote, repo } = setup();
    await repo.hydrate("u1");
    const p = applyAnswer(newProgress("pubA", "state_FL", "1.1", T0), true, T0 + 10);
    await repo.putProgress([p]);
    await repo.putSession(session());
    expect((await cache.outboxAll()).map((e) => e.key).sort()).toEqual([`progress:pubA`, `session:${UUID}`]);
    expect(await repo.pendingCount()).toBe(2);

    const r = await repo.flush();
    expect(r.ok).toBe(true);
    expect(r.pushedProgress).toBe(1);
    expect(r.pushedSessions).toBe(1);
    expect(remote!.progress.get("pubA")).toMatchObject({ public_id: "pubA", attempts: 1, correct: 1, box: "yellow" });
    expect(remote!.sessions.get(UUID)).toMatchObject({ id: UUID, kind: "practice", item_ids: ["pubA", "pubB"] });
    expect(await repo.pendingCount()).toBe(0);
    expect(await cache.getKv(SYNC_SINCE_KV)).toBe(remote!.calls[0]!.since === null ? iso(remote!.clock) : iso(remote!.clock));
  });

  it("keeps the outbox when offline and replays it once the network is back (nothing lost)", async () => {
    const remote = new FakeRemote();
    let online = false;
    const { cache, repo } = setup({ remote, online: () => online });
    await repo.hydrate("u1");
    await repo.putProgress([applyAnswer(newProgress("pubA", "state_FL", "1.1", T0), false, T0 + 10)]);
    await repo.setSettings({ jurisdiction: "FL" });
    expect((await repo.flush()).reason).toBe("offline");
    expect(await cache.outboxAll()).toHaveLength(2);
    expect(remote.progress.size).toBe(0);

    remote.offline = true; online = true;
    const failed = await repo.flush();
    expect(failed.ok).toBe(false);
    expect(failed.reason).toBe("error");
    expect(await cache.outboxAll()).toHaveLength(2); // still queued

    remote.offline = false;
    const ok = await repo.flush();
    expect(ok.ok).toBe(true);
    expect(ok.pushedStudyState).toBe(true);
    expect(remote.progress.get("pubA")?.box).toBe("red");
    expect(remote.studyState?.settings.jurisdiction).toBe("FL");
    expect(await cache.outboxAll()).toHaveLength(0);
  });

  it("does not drop an outbox entry that was rewritten while the push was in flight", async () => {
    const remote = new FakeRemote();
    const { cache, repo } = setup({ remote });
    await repo.hydrate("u1");
    const p1 = applyAnswer(newProgress("pubA", "state_FL", "1.1", T0), true, T0 + 10);
    await repo.putProgress([p1]);
    const origSync = remote.sync.bind(remote);
    remote.sync = async (payload) => {
      const res = await origSync(payload);
      // a second answer lands before the response is processed
      await repo.putProgress([applyAnswer(p1, false, T0 + 20)]);
      return res;
    };
    await repo.flush();
    const left = await cache.outboxAll();
    expect(left).toHaveLength(1);
    expect((left[0]!.payload as ServerProgressRow).attempts).toBe(2);
  });
});

describe("repo: last write wins", () => {
  it("adopts newer server progress and keeps newer local progress", async () => {
    const remote = new FakeRemote();
    // server already holds pubA (newer) and pubZ (unknown locally); local has pubA (older) and pubB
    remote.progress.set("pubA", { public_id: "pubA", attempts: 5, correct: 4, last_answered_at: iso(T0 + 900), box: "green", due_at: iso(T0 + 9000), client_updated_at: iso(T0 + 900), updated_at: iso(T0 + 901) });
    remote.progress.set("pubZ", { public_id: "pubZ", attempts: 1, correct: 0, last_answered_at: iso(T0 + 50), box: "red", due_at: iso(T0 + 50), client_updated_at: iso(T0 + 50), updated_at: iso(T0 + 51) });
    remote.progress.set("pubB", { public_id: "pubB", attempts: 1, correct: 1, last_answered_at: iso(T0 + 1), box: "yellow", due_at: iso(T0 + 100), client_updated_at: iso(T0 + 1), updated_at: iso(T0 + 2) });
    const { cache, repo } = setup({ remote });
    cache.items.set("pubZ", { bank: "national_psi", node: "IV.B" });
    await cache.putProgress([applyAnswer(newProgress("pubA", "state_FL", "1.1", T0), true, T0 + 100)]);
    const localB = applyAnswer(applyAnswer(newProgress("pubB", "state_FL", "1.2", T0), true, T0 + 100), true, T0 + 200);
    await cache.putProgress([localB]);
    await cache.outboxPut([{ key: "progress:pubB", kind: "progress", payload: { public_id: "pubB", attempts: 2, correct: 2, last_answered_at: iso(T0 + 200), box: "green", due_at: iso(localB.dueAt), client_updated_at: iso(T0 + 200) }, at: T0 + 200, attempts: 0 }]);

    await repo.hydrate("u1");

    const a = await repo.getProgress("pubA");
    expect(a).toMatchObject({ attempts: 5, correct: 4, box: "green", clientUpdatedAt: T0 + 900, bank: "state_FL", node: "1.1" });
    const z = await repo.getProgress("pubZ");
    expect(z).toMatchObject({ itemId: "pubZ", bank: "national_psi", node: "IV.B", box: "red" });
    const b = await repo.getProgress("pubB");
    expect(b!.clientUpdatedAt).toBe(T0 + 200); // ours was newer: kept locally …
    expect(remote.progress.get("pubB")!.attempts).toBe(2); // … and pushed to the server
  });

  it("resolves study_state by updated_at in both directions", async () => {
    const remote = new FakeRemote();
    remote.studyState = { user_id: "u1", settings: { jurisdiction: "TX", licenseLevel: "broker", examDate: "2026-12-01", narrationRate: 1.25, autoAdvance: true, sharingNoticeAck: true, sessionSize: 30 }, plan: null, updated_at: iso(T0 + 5000) };
    // this device holds an older local copy from before
    const { cache, repo } = setup({ remote, now: () => T0 + 6000 });
    await cache.putKv("studyState", { settings: { jurisdiction: "FL", licenseLevel: "salesperson", examDate: null, narrationRate: 1, autoAdvance: false, sharingNoticeAck: false, sessionSize: 20 }, plan: null, updatedAt: T0 + 100 });
    await cache.putKv(OWNER_KV_KEY, "u1");
    await repo.hydrate("u1");
    expect(repo.settings().jurisdiction).toBe("TX");
    expect(repo.settings().sessionSize).toBe(30);
    expect(repo.stateUpdatedAt()).toBe(T0 + 5000);

    // a newer local change wins over the server row and is pushed
    await repo.setSettings({ examDate: "2027-01-15" });
    expect(repo.stateUpdatedAt()).toBe(T0 + 6000);
    await repo.flush();
    expect(remote.studyState?.settings.examDate).toBe("2027-01-15");
    expect(remote.studyState?.settings.jurisdiction).toBe("TX");

    // an even newer server row (another device) replaces ours on the next hydrate
    remote.studyState = { ...remote.studyState!, settings: { ...remote.studyState!.settings, jurisdiction: "CA" }, updated_at: iso(T0 + 7000) };
    await repo.hydrate("u1");
    expect(repo.settings().jurisdiction).toBe("CA");
    expect(repo.settings().examDate).toBe("2027-01-15");
  });

  it("pulls a session left open on another device and makes it the active one", async () => {
    const remote = new FakeRemote();
    remote.sessions.set(UUID, {
      id: UUID, kind: "mock", jurisdiction: "FL", bank: "state_FL", form_id: "short", batch_id: null, started_at: iso(T0), ended_at: null, position: 3,
      answers: [{ item_id: "p1", choice: "A", correct: true, at: iso(T0 + 1), elapsed_ms: 100 }], time_remaining_s: 500,
      client_updated_at: iso(T0 + 300), updated_at: iso(T0 + 301), item_ids: ["p1", "p2", "p3", "p4", "p5"],
    });
    const { repo } = setup({ remote });
    await repo.hydrate("u1");
    const active = await repo.activeSession();
    expect(active?.id).toBe(UUID);
    expect(active?.itemIds).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(active?.position).toBe(3);
    expect(active?.answers.p1?.correct).toBe(true);
  });
});

describe("repo: account switch", () => {
  it("wipes learner data when a different user signs in on the same device", async () => {
    const remote = new FakeRemote();
    const { cache, repo } = setup({ remote });
    await repo.hydrate("u1");
    await repo.putProgress([applyAnswer(newProgress("pubA", "state_FL", "1.1", T0), true, T0 + 10)]);
    await repo.setSettings({ jurisdiction: "FL" });
    await repo.setActiveSession(UUID);
    await repo.flush();
    expect((await cache.allProgress())).toHaveLength(1);

    remote.progress.clear(); remote.studyState = null; // u2 is a fresh account server-side
    await repo.hydrate("u2");
    expect(await cache.allProgress()).toHaveLength(0);
    expect(await cache.getKv(ACTIVE_SESSION_KV)).toBeUndefined();
    expect(repo.settings().jurisdiction).toBe("");
    expect(await cache.getKv(OWNER_KV_KEY)).toBe("u2");
  });

  it("with no server (static dev mode) the cache still works and flush reports no_remote", async () => {
    const { repo } = setup({ remote: null });
    await repo.open();
    await repo.setSettings({ jurisdiction: "NY" });
    expect(repo.settings().jurisdiction).toBe("NY");
    expect((await repo.flush()).reason).toBe("no_remote");
  });
});
