/**
 * The study engine facade used by pages: banks for the chosen state, scheduling, sessions,
 * answering (persisted per question), SRS pipeline, coverage and readiness.
 *
 * Item source by mode (lib/study/mode.ts):
 *   static → StaticItemSource over public/content/items.json (DEV ONLY — embeds real ids)
 *   free   → StaticItemSource too, but the free-tier gate limits what a session may draw
 *   api    → ApiItemSource: signed batches from issue-batch under public ids; sync in background
 */
import type { Item, OptionLetter, StateRecord, Blueprint } from "@rep/schema";
import { nationalBankFor, keyIndex } from "@rep/schema";
import { getDb } from "~~/lib/study/db";
import { ApiItemSource, StaticItemSource, type ItemSource } from "~~/lib/study/itemSource";
import { functionsBase } from "~~/lib/study/api";
import { newProgress, applyAnswer, scheduleSession, pipeline, leechDrill } from "~~/lib/study/srs";
import { coverage } from "~~/lib/study/coverage";
import { readiness, passItemsFrom } from "~~/lib/study/readiness";
import type { Progress, StudySession, SessionKind } from "~~/lib/study/types";

/** IndexedDB structured-clone rejects Vue reactive proxies; always persist plain copies. */
function plain<T>(v: T): T { return JSON.parse(JSON.stringify(toRaw(v))) as T; }

let staticSource: StaticItemSource | null = null;
let apiSource: ApiItemSource | null = null;
let apiSourceFor: string | null = null;

export function useStudy() {
  const settings = useSettings();
  const { load } = useContent();
  const config = useRuntimeConfig();
  const mode = useAppMode();
  const auth = useAuth();
  const freeTier = useFreeTier();
  const sync = useSync();
  const db = getDb();

  function source(): ItemSource {
    const uid = auth.user.value?.id;
    if (mode.value === "api" && uid) {
      if (!apiSource || apiSourceFor !== uid) {
        apiSource = new ApiItemSource({
          base: functionsBase(config.public.supabaseUrl),
          headers: () => auth.apiHeaders(),
          jurisdiction: () => settings.jurisdiction,
          db,
          onSessionRevoked: () => { void auth.onSessionRevoked(); },
          onFreeTier: (info) => freeTier.noteServerFreeTier(info),
          onSharingNoticeAck: (acked) => { if (acked && !settings.sharingNoticeAck) settings.set("sharingNoticeAck", true); },
          onError: (e) => console.warn("[items] issue-batch failed; studying from cache", e),
        });
        apiSourceFor = uid;
      }
      return apiSource;
    }
    // DEV ONLY / anonymous free sample — see lib/study/itemSource.ts header.
    if (!staticSource) staticSource = new StaticItemSource(`${config.public.contentBase}/items.json`);
    return staticSource;
  }

  async function state(): Promise<StateRecord | null> {
    const m = await load();
    return settings.jurisdiction ? (m.states[settings.jurisdiction] ?? null) : null;
  }
  async function banks(): Promise<{ national: string | null; state: string | null }> {
    const st = await state();
    return { national: st ? nationalBankFor(st.vendor) : null, state: settings.stateBank };
  }
  async function blueprint(bank: string): Promise<Blueprint | null> {
    const m = await load();
    return m.blueprints[bank] ?? null;
  }

  async function cacheItems(items: Item[]) {
    await db.items.bulkPut(items.map((item) => ({ id: item.id, bank: item.bank, node: item.blueprint_node, item: plain(item), cachedAt: Date.now() })));
  }
  async function getItems(ids: string[]): Promise<Item[]> {
    const cached = await db.items.bulkGet(ids);
    const missing = ids.filter((_, i) => !cached[i]);
    let fetched: Item[] = [];
    if (missing.length) { fetched = await source().get(missing); await cacheItems(fetched); }
    const byId = new Map<string, Item>();
    for (const c of cached) if (c) byId.set(c.id, c.item);
    for (const f of fetched) byId.set(f.id, f);
    return ids.map((id) => byId.get(id)).filter((x): x is Item => !!x);
  }

  async function progressMap(bank?: string): Promise<Map<string, Progress>> {
    const rows = bank ? await db.progress.where("bank").equals(bank).toArray() : await db.progress.toArray();
    return new Map(rows.map((r) => [r.itemId, r]));
  }

  async function startSession(kind: SessionKind, opts: { banks: string[]; size?: number; itemIds?: string[]; timeLimitMs?: number | null; mockFormId?: string | null; portions?: StudySession["portions"] }): Promise<StudySession> {
    let itemIds = opts.itemIds;
    if (!itemIds) {
      const cands: string[] = [];
      for (const b of opts.banks) cands.push(...(await source().ids(b)));
      const prog = await progressMap();
      itemIds = kind === "drill" ? leechDrill(prog.values(), opts.size ?? 20) : scheduleSession({ candidates: cands, progress: prog, size: opts.size ?? settings.sessionSize });
      // SPEC §6: on the free tier a session may only draw what is left of the 40-question allowance
      if (freeTier.applies.value) { await freeTier.load(); itemIds = freeTier.limit(itemIds); }
    }
    const now = Date.now();
    // uuid so the row can sync as-is (study_sessions.id is a uuid server-side)
    const s: StudySession = { id: crypto.randomUUID(), kind, jurisdiction: settings.jurisdiction, banks: opts.banks, itemIds, position: 0, answers: {}, startedAt: now, endedAt: null, timeLimitMs: opts.timeLimitMs ?? null, mockFormId: opts.mockFormId ?? null, portions: opts.portions, clientUpdatedAt: now };
    await db.sessions.put(plain(s));
    await db.kv.put({ key: "activeSession", value: s.id });
    sync.schedule();
    return s;
  }
  async function activeSession(): Promise<StudySession | null> {
    const kv = await db.kv.get("activeSession");
    if (!kv) return null;
    const s = await db.sessions.get(kv.value as string);
    return s && !s.endedAt ? s : null;
  }
  async function saveSession(s: StudySession) { s.clientUpdatedAt = Date.now(); await db.sessions.put(plain(s)); sync.schedule(); }

  /** Persist the answer immediately (F8), update SRS, advance the session position (F9). */
  async function answer(s: StudySession, item: Item, choice: OptionLetter, elapsedMs: number): Promise<{ correct: boolean; progress: Progress }> {
    const now = Date.now();
    const correct = keyIndex(choice) === keyIndex(item.key);
    s.answers[item.id] = { itemId: item.id, choice, correct, at: now, elapsedMs };
    const prev = (await db.progress.get(item.id)) ?? newProgress(item.id, item.bank, item.blueprint_node, now);
    const next = applyAnswer(prev, correct, now);
    // Mocks are graded but must not reschedule SRS boxes until the mock ends (keeps forms honest).
    await db.transaction("rw", db.progress, db.sessions, async () => {
      if (s.kind !== "mock") await db.progress.put(next);
      await db.sessions.put(plain({ ...s, clientUpdatedAt: now }));
    });
    await freeTier.recordAnswer(item.id, s.jurisdiction || (item.jurisdiction === "NAT" ? settings.jurisdiction : item.jurisdiction));
    sync.schedule();
    return { correct, progress: next };
  }
  async function endSession(s: StudySession) {
    s.endedAt = Date.now();
    if (s.kind === "mock") {
      // apply SRS updates from mock answers once, at the end
      for (const a of Object.values(s.answers)) {
        const c = await db.items.get(a.itemId);
        const prev = (await db.progress.get(a.itemId)) ?? newProgress(a.itemId, c?.bank ?? s.banks[0]!, c?.node ?? "?", a.at);
        await db.progress.put(applyAnswer(prev, a.correct, a.at));
      }
    }
    await saveSession(s);
    await db.kv.delete("activeSession");
  }

  async function pipelineFor(bank: string) {
    const ids = await source().ids(bank);
    const prog = await progressMap(bank);
    return pipeline([...prog.values()], ids.length);
  }
  async function coverageFor(bank: string) {
    const bp = await blueprint(bank);
    if (!bp) return null;
    const items = await source().get(await source().ids(bank));
    const nodes = new Map(items.map((i) => [i.id, i.blueprint_node]));
    return coverage(bp, nodes, await progressMap(bank), settings.licenseLevel);
  }
  async function readinessFor(bank: string, portion: "national" | "state") {
    const bp = await blueprint(bank);
    const st = await state();
    if (!bp || !st) return null;
    const exam = settings.licenseLevel === "broker" && st.broker_exam ? st.broker_exam : st.salesperson_exam;
    const scored = portion === "national" ? exam.national_items ?? bp.exams.salesperson.scored_items : exam.state_items ?? exam.total_items ?? bp.exams.salesperson.scored_items;
    const pass = portion === "national" ? exam.pass_score_national ?? exam.pass_score_combined : exam.pass_score_state ?? exam.pass_score_combined;
    const prog = [...(await progressMap(bank)).values()];
    return readiness(bp, prog, { portion, scoredItems: scored!, passThreshold: passItemsFrom(pass, scored!), exam: settings.licenseLevel });
  }
  async function missedQueue(): Promise<Progress[]> {
    return (await db.progress.toArray()).filter((p) => p.box === "red" || p.leech).sort((a, b) => b.misses - a.misses);
  }

  return {
    state, banks, blueprint, getItems, startSession, activeSession, saveSession, answer, endSession, pipelineFor, coverageFor, readinessFor, missedQueue, mode,
    get source() { return source(); },
  };
}
