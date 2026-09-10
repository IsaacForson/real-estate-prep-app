/**
 * The study engine facade (V2 §6.1): sessions, answering, SRS, coverage and readiness — every
 * learner write goes through the repo (cache now, server on the next flush; lib/state/repo.ts).
 *
 * Item source by mode (lib/study/mode.ts):
 *   static → StaticItemSource over public/content/items.json (DEV ONLY — embeds real ids)
 *   api    → ApiItemSource: signed batches from issue-batch under public ids; the response's
 *            free_tier block feeds useFreeTier (no local counting)
 *
 * Two API surfaces live here during the V2 rewrite: the session-centric one WP-C builds against
 * (`startPractice`, `startMock`, `resume`, `answer(choice)`, `next`, `finish`, `current`, `session`)
 * and the older explicit-session functions the pre-V2 pages still call. Both write through the repo.
 */
import type { Item, OptionLetter, StateRecord, Blueprint } from "@rep/schema";
import { nationalBankFor, keyIndex } from "@rep/schema";
import type { Ref } from "vue";
import { parseMockStart, type MockFinishResponse } from "~~/lib/state/contracts";
import { buildMockPortions, planMockForm, scoreSession } from "~~/lib/state/mock";
import { getDb } from "~~/lib/study/db";
import { ApiItemSource, StaticItemSource, fetchBatchItems, LOOK_AHEAD_MIN, type ItemSource } from "~~/lib/study/itemSource";
import { ApiError, callFunction, functionsBase, isFreeTierError } from "~~/lib/study/api";
import { newProgress, applyAnswer, scheduleSession, pipeline, leechDrill } from "~~/lib/study/srs";
import { coverage } from "~~/lib/study/coverage";
import { readiness, passItemsFrom } from "~~/lib/study/readiness";
import type { Progress, StudySession, SessionKind } from "~~/lib/study/types";

/** IndexedDB structured-clone rejects Vue reactive proxies; always persist plain copies. */
function plain<T>(v: T): T { return JSON.parse(JSON.stringify(toRaw(v))) as T; }

let staticSource: StaticItemSource | null = null;
let apiSource: ApiItemSource | null = null;
let apiSourceFor: string | null = null;

export interface StartPracticeOptions {
  /** one bank, or … */
  bank?: string;
  /** … several; defaults to the state bank + the vendor's national bank for the chosen jurisdiction */
  banks?: string[];
  /** restrict to a blueprint node (and its subtopics), e.g. "IV" or "IV.B" */
  node?: string;
  size?: number;
  kind?: Extract<SessionKind, "practice" | "drill" | "review">;
  /** explicit item list (review of missed items, a drill) */
  itemIds?: string[];
  /** study ahead: schedule cards that are not due yet (see scheduleSession) */
  ignoreSchedule?: boolean;
}

/** The lower-level session builder's options; `startPractice` is the friendly face over this. */
export interface StartSessionOptions {
  banks: string[];
  size?: number;
  itemIds?: string[];
  node?: string;
  timeLimitMs?: number | null;
  mockFormId?: string | null;
  portions?: StudySession["portions"];
  id?: string;
  ignoreSchedule?: boolean;
}

export interface FinishSummary {
  session: StudySession;
  correct: number;
  total: number;
  pct: number;
  portions: Array<{ portion: string; correct: number; total: number; passScore: string | null }>;
  /** server score for mocks when mock-finish answered */
  server: MockFinishResponse | null;
}

/** `activeSession` is a Ref (V2 §6.1) that pre-V2 pages may still call as `await activeSession()`. */
export type ActiveSessionRef = Ref<StudySession | null> & (() => Promise<StudySession | null>);

export function useStudy() {
  const settings = useSettings();
  const studyState = useStudyState();
  const { load } = useContent();
  const config = useRuntimeConfig();
  const mode = useAppMode();
  const auth = useAuth();
  const freeTier = useFreeTier();
  const sync = useSync();
  const events = useEvents();
  const availability = useContentAvailability();
  const { repo, version } = useRepo();
  const db = getDb();
  /** the vendor's national bank for the chosen state, remembered so issue-batch can name the fallback */
  const natBank = useState<string | null>("study.nationalBank", () => null);

  // ---- reactive session state (shared across screens) ----------------------------------------
  const session = useState<StudySession | null>("study.session", () => null);
  const items = useState<Item[]>("study.items", () => []);
  const active = useState<StudySession | null>("study.active", () => null);
  const activeLoaded = useState<boolean>("study.activeLoaded", () => false);
  /** finished sessions, newest first (results / history screens); refreshed on every repo change */
  const history = useState<StudySession[]>("study.history", () => []);
  const current = computed<Item | null>(() => (session.value ? items.value[session.value.position] ?? null : null));
  const startedAt = useState<number>("study.startedAt", () => Date.now());

  const jurisdiction = () => studyState.settings.value.jurisdiction || settings.jurisdiction;
  const licenseLevel = () => studyState.settings.value.licenseLevel;

  function source(): ItemSource {
    const uid = auth.user.value?.id;
    if (mode.value === "api" && uid) {
      if (!apiSource || apiSourceFor !== uid) {
        apiSource = new ApiItemSource({
          base: functionsBase(config.public.supabaseUrl),
          headers: () => auth.apiHeaders(),
          jurisdiction: () => jurisdiction(),
          nationalBank: () => natBank.value,
          db,
          onSessionRevoked: () => { void auth.onSessionRevoked(); },
          onFreeTier: (info) => freeTier.noteServerFreeTier(info),
          onAvailability: (a) => availability.note(a),
          onSharingNoticeAck: (acked) => { if (acked && !studyState.settings.value.sharingNoticeAck) void studyState.set({ sharingNoticeAck: true }); },
          onError: (e) => console.warn("[items] issue-batch failed; studying from cache", e),
        });
        apiSourceFor = uid;
      }
      return apiSource;
    }
    // DEV ONLY — see lib/study/itemSource.ts header.
    if (!staticSource) staticSource = new StaticItemSource(`${config.public.contentBase}/items.json`);
    return staticSource;
  }

  async function state(): Promise<StateRecord | null> {
    const m = await load();
    const j = jurisdiction();
    return j ? (m.states[j] ?? null) : null;
  }
  async function banks(): Promise<{ national: string | null; state: string | null }> {
    const st = await state();
    const j = jurisdiction();
    const national = st ? nationalBankFor(st.vendor) : null;
    if (national) natBank.value = national;
    return { national, state: j ? `state_${j}` : null };
  }

  /**
   * Warm the cache right after sign-in (V2 "never an empty screen"): one national batch in the
   * background so the first Study tap shows a question instantly. The state bank is asked for as
   * well; when it has nothing published the server says so and the loop simply runs national.
   */
  async function seedCache(): Promise<void> {
    if (mode.value !== "api" || !auth.user.value) return;
    const b = await banks();
    const src = source();
    const targets = [b.national, b.state].filter((x): x is string => !!x);
    await Promise.all(targets.map((bank) => src.prefetch?.(bank, LOOK_AHEAD_MIN).catch(() => {})));
  }
  async function blueprint(bank: string): Promise<Blueprint | null> {
    const m = await load();
    return m.blueprints[bank] ?? null;
  }

  async function cacheItems(list: Item[]) {
    await db.items.bulkPut(list.map((item) => ({ id: item.id, bank: item.bank, node: item.blueprint_node, item: plain(item), cachedAt: Date.now() })));
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

  const progressMap = (bank?: string) => repo.progressMap(bank);
  const progressFor = async (itemId: string): Promise<Progress | null> => (await repo.getProgress(itemId)) ?? null;

  // ---- sessions ------------------------------------------------------------------------------

  async function loadSession(s: StudySession): Promise<StudySession> {
    session.value = s;
    items.value = await getItems(s.itemIds);
    startedAt.value = Date.now();
    return s;
  }

  async function startSession(kind: SessionKind, opts: StartSessionOptions, extra: { dryRun: true }): Promise<StudySession | null>;
  async function startSession(kind: SessionKind, opts: StartSessionOptions, extra?: { dryRun?: boolean }): Promise<StudySession>;
  async function startSession(kind: SessionKind, opts: StartSessionOptions, extra: { dryRun?: boolean } = {}): Promise<StudySession | null> {
    let itemIds = opts.itemIds;
    if (!itemIds) {
      let cands: string[] = [];
      for (const b of opts.banks) cands.push(...(await source().ids(b)));
      if (opts.node) {
        const n = opts.node;
        const nodes = new Map((await source().get(cands)).map((i) => [i.id, i.blueprint_node]));
        cands = cands.filter((id) => { const bn = nodes.get(id); return !!bn && (bn === n || bn.startsWith(n + ".")); });
      }
      const prog = await progressMap();
      itemIds = kind === "drill"
        ? leechDrill(prog.values(), opts.size ?? 20)
        : scheduleSession({ candidates: cands, progress: prog, size: opts.size ?? studyState.settings.value.sessionSize, ignoreSchedule: opts.ignoreSchedule });
      // SPEC §6: on the free tier a session may only draw what is left of the allowance (server recounts)
      if (freeTier.applies.value) itemIds = freeTier.limit(itemIds, (id) => (prog.get(id)?.attempts ?? 0) > 0);
    }
    if (!itemIds.length && extra.dryRun) return null;
    const now = Date.now();
    // uuid so the row can sync as-is (study_sessions.id is a uuid server-side)
    const s: StudySession = { id: opts.id ?? crypto.randomUUID(), kind, jurisdiction: jurisdiction(), banks: opts.banks, itemIds, position: 0, answers: {}, startedAt: now, endedAt: null, timeLimitMs: opts.timeLimitMs ?? null, mockFormId: opts.mockFormId ?? null, portions: opts.portions, clientUpdatedAt: now };
    await repo.putSession(plain(s));
    await repo.setActiveSession(s.id);
    active.value = s;
    events.track(kind === "mock" ? "mock_start" : "session_start", { session_id: s.id, kind, jurisdiction: s.jurisdiction, items: itemIds.length, form_id: s.mockFormId });
    sync.schedule();
    return loadSession(s);
  }

  /**
   * Practice (or drill / review) for the chosen state; defaults to both banks of the exam. Returns
   * null when nothing can be scheduled (bank too thin, free tier exhausted, no leeches to drill) so
   * no empty session row is created.
   */
  async function startPractice(opts: StartPracticeOptions = {}): Promise<StudySession | null> {
    let bs = opts.banks ?? (opts.bank ? [opts.bank] : undefined);
    if (!bs) { const b = await banks(); bs = [b.national, b.state].filter((x): x is string => !!x); }
    if (!bs.length) return null;
    const s = await startSession(opts.kind ?? "practice", { banks: bs, size: opts.size, itemIds: opts.itemIds, node: opts.node, ignoreSchedule: opts.ignoreSchedule }, { dryRun: true });
    return s;
  }

  /**
   * A mock in the state's exact format. In api mode the server builds it (`mock-start`, V2 §6.3);
   * when that function is unavailable the client assembles the same form locally. Free-tier errors
   * (`free_tier_mock_limit` …) propagate so the screen can show the gate.
   */
  async function startMock(formId: string | null = null): Promise<StudySession | null> {
    const st = await state();
    if (!st) return null;
    const short = freeTier.applies.value;
    const spec = planMockForm(st, { licenseLevel: licenseLevel(), maxItems: short ? freeTier.mockSize : null });
    const nationalBank = nationalBankFor(st.vendor);
    if (nationalBank) natBank.value = nationalBank;
    const form = formId ?? (short ? freeTier.mockForm : `local-${Date.now().toString(36)}`);

    if (mode.value === "api") {
      const headers = await auth.apiHeaders();
      if (headers) {
        try {
          // the server serves a published form (mock_forms) when one exists, else draws fresh
          const body: Record<string, unknown> = { form_id: form, jurisdiction: st.code };
          if (nationalBank) body.national_bank = nationalBank;
          const raw = await callFunction<unknown>(functionsBase(config.public.supabaseUrl), "mock-start", body, headers);
          const res = parseMockStart(raw);
          if (res) {
            for (const b of res.batches ?? []) await cacheItems(await fetchBatchItems(b));
            if (res.free_tier) freeTier.noteServerFreeTier(res.free_tier);
            const portions = res.portions?.map((p) => ({ portion: p.portion, bank: p.bank, itemIds: p.item_ids, passScore: p.pass_score }));
            await freeTier.markMockUsed();
            return startSession("mock", {
              id: res.session_id, banks: portions?.map((p) => p.bank) ?? [nationalBank, `state_${st.code}`].filter((x): x is string => !!x),
              itemIds: res.item_ids, timeLimitMs: res.time_limit_s != null ? res.time_limit_s * 1000 : spec?.timeLimitMs ?? null, mockFormId: res.form_id || form, portions,
            });
          }
        } catch (e) {
          if (isFreeTierError(e)) {
            // the server says no (mock used / allowance gone): useFreeTier reflects it, the screen shows the gate
            if (e.code === "free_tier_mock_limit" || e.code === "free_tier_mock_form") await freeTier.markMockUsed();
            else if (e.code === "free_tier_exhausted") freeTier.noteServerFreeTier({ remaining: 0, total: freeTier.total });
            return null;
          }
          // A definitive refusal is an answer, not a failure to reach the server: mock-start says
          // `bank_short` when the jurisdiction cannot fill the form to the real exam's shape, and
          // `no_items` when a bank is empty. Falling through to local assembly there rebuilt exactly
          // the short, wrongly-proportioned form the server had just declined to build — and left an
          // abandoned session the app then advertised as "Mock in progress".
          if (e instanceof ApiError && (e.code === "bank_short" || e.code === "no_items")) return null;
          if (!(e instanceof ApiError && (e.status === 404 || e.code === "http_404" || e.code === "not_found"))) console.warn("[mock-start] falling back to a local form", e);
        }
      }
    }
    // local assembly (static dev mode, or mock-start not deployed)
    if (!spec) return null;
    if (short && freeTier.mockUsed.value) return null;
    const prog = await progressMap();
    const built = await buildMockPortions(spec, {
      blueprint,
      ids: async (bank) => {
        await source().prefetch?.(bank, spec.plan.find((p) => p.bank === bank)?.count ?? 0, { kind: "mock", formId: form });
        return freeTier.limit(await source().ids(bank), (id) => (prog.get(id)?.attempts ?? 0) > 0);
      },
      items: getItems,
    });
    if (!built.itemIds.length) return null;
    await freeTier.markMockUsed();
    return startSession("mock", { banks: built.portions.map((p) => p.bank), itemIds: built.itemIds, timeLimitMs: built.timeLimitMs, mockFormId: form, portions: built.portions });
  }

  /** Continue an unfinished session (this device or another — the repo pulled it). */
  async function resume(sessionId?: string): Promise<StudySession | null> {
    const s = sessionId ? await repo.getSession(sessionId) : await repo.activeSession();
    if (!s || s.endedAt) return null;
    // A session is only resumable while its questions can still be resolved. Batch content has a
    // six-hour TTL and the local cache can be cleared, so an older session can point at ids that no
    // longer exist on this device. Offering "Continue your session" and then having nothing to show
    // is worse than not offering it, so retire the session and let the learner start a fresh one.
    if (s.itemIds.length > 0 && (await getItems(s.itemIds)).length === 0) {
      await repo.setActiveSession(null);
      active.value = null;
      session.value = null;
      items.value = [];
      return null;
    }
    await repo.setActiveSession(s.id);
    active.value = s;
    events.track("session_resume", { session_id: s.id, kind: s.kind, position: s.position });
    return loadSession(s);
  }

  async function refreshActive(): Promise<StudySession | null> {
    active.value = await repo.activeSession();
    activeLoaded.value = true;
    return active.value;
  }
  /** Finished sessions, newest first. */
  async function loadHistory(limit = 50): Promise<StudySession[]> {
    history.value = (await repo.allSessions()).filter((s) => !!s.endedAt).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, limit);
    return history.value;
  }
  if (import.meta.client) {
    if (!activeLoaded.value) { activeLoaded.value = true; void refreshActive(); void loadHistory(); }
    // keep `activeSession` / `history` current for every consuming component (disposed with it)
    if (getCurrentScope()) watch(version, () => { void refreshActive(); void loadHistory(); });
  }
  const activeSession = Object.assign(refreshActive, {
    get value() { return active.value; },
    set value(v: StudySession | null) { active.value = v; },
  }) as unknown as ActiveSessionRef;

  async function saveSession(s: StudySession) {
    s.clientUpdatedAt = Date.now();
    await repo.putSession(plain(s));
    if (session.value?.id === s.id) session.value = { ...plain(s) };
    sync.schedule();
  }

  /** Persist the answer immediately (F8), update SRS, keep the session row current. */
  async function answerItem(s: StudySession, item: Item, choice: OptionLetter, elapsedMs: number): Promise<{ correct: boolean; progress: Progress }> {
    const now = Date.now();
    const correct = keyIndex(choice) === keyIndex(item.key);
    s.answers[item.id] = { itemId: item.id, choice, correct, at: now, elapsedMs };
    s.clientUpdatedAt = now;
    const prev = await repo.getProgress(item.id);
    const wasUnseen = !prev || prev.attempts === 0;
    const next = applyAnswer(prev ?? newProgress(item.id, item.bank, item.blueprint_node, now), correct, now);
    // Mocks are graded but must not reschedule SRS boxes until the mock ends (keeps forms honest).
    if (s.kind !== "mock") await repo.putProgress([next]);
    await repo.putSession(plain(s));
    if (session.value?.id === s.id) session.value = { ...plain(s) };
    await freeTier.recordAnswer(item.id, s.jurisdiction || (item.jurisdiction === "NAT" ? jurisdiction() : item.jurisdiction), wasUnseen);
    events.track("answer", { session_id: s.id, item_id: item.id, correct, ms: Math.round(elapsedMs), kind: s.kind, bank: item.bank, node: item.blueprint_node });
    sync.schedule();
    return { correct, progress: next };
  }

  /** `answer(choice)` for the current item, or the pre-V2 `answer(session, item, choice, elapsedMs)`. */
  function answer(choice: OptionLetter): Promise<{ correct: boolean; progress: Progress }>;
  function answer(s: StudySession, item: Item, choice: OptionLetter, elapsedMs: number): Promise<{ correct: boolean; progress: Progress }>;
  function answer(a: OptionLetter | StudySession, item?: Item, choice?: OptionLetter, elapsedMs?: number) {
    if (typeof a === "string") {
      const s = session.value, it = current.value;
      if (!s || !it) return Promise.reject(new Error("no active question"));
      return answerItem(s, it, a, Date.now() - startedAt.value);
    }
    return answerItem(a, item!, choice!, elapsedMs ?? 0);
  }

  /** Advance the current session; false when already on the last question. */
  async function next(): Promise<boolean> {
    const s = session.value;
    if (!s) return false;
    if (s.position + 1 >= s.itemIds.length) return false;
    const copy = { ...plain(s), position: s.position + 1 };
    await saveSession(copy);
    startedAt.value = Date.now();
    return true;
  }

  /** Jump to a question (mocks let you review before submitting). */
  async function goTo(position: number): Promise<void> {
    const s = session.value;
    if (!s) return;
    const copy = { ...plain(s), position: Math.min(Math.max(0, position), Math.max(0, s.itemIds.length - 1)) };
    await saveSession(copy);
    startedAt.value = Date.now();
  }

  async function endSession(s: StudySession): Promise<FinishSummary> {
    s.endedAt = Date.now();
    if (s.kind === "mock") {
      // apply SRS updates from mock answers once, at the end
      const writes: Progress[] = [];
      for (const a of Object.values(s.answers)) {
        const c = await db.items.get(a.itemId);
        const prev = (await repo.getProgress(a.itemId)) ?? newProgress(a.itemId, c?.bank ?? s.banks[0]!, c?.node ?? "?", a.at);
        writes.push(applyAnswer(prev, a.correct, a.at));
      }
      await repo.putProgress(writes);
    }
    await saveSession(s);
    await repo.setActiveSession(null);
    active.value = null;
    const local = scoreSession(s);
    let server: MockFinishResponse | null = null;
    if (s.kind === "mock" && mode.value === "api") {
      const headers = await auth.apiHeaders();
      if (headers) {
        try {
          server = await callFunction<MockFinishResponse>(functionsBase(config.public.supabaseUrl), "mock-finish", {
            session_id: s.id,
            answers: Object.values(s.answers).map((a) => ({ item_id: a.itemId, choice: a.choice, correct: a.correct, at: new Date(a.at).toISOString(), elapsed_ms: Math.round(a.elapsedMs) })),
            time_used_s: Math.round((s.endedAt - s.startedAt) / 1000),
          }, headers);
        } catch (e) { if (import.meta.dev) console.warn("[mock-finish]", e); }
      }
    }
    if (s.kind === "mock") events.track("mock_finish", { session_id: s.id, form_id: s.mockFormId, correct: local.correct, total: local.total, pct: Math.round(local.pct), server_score: server?.score ?? null });
    sync.schedule(500);
    return { session: s, ...local, server };
  }

  /** Drop the active session without scoring it (its items are no longer available on this device). */
  async function discard(): Promise<void> {
    const s = session.value ?? active.value;
    if (s) { const copy = { ...plain(s), endedAt: Date.now() }; await saveSession(copy); }
    await repo.setActiveSession(null);
    active.value = null; session.value = null; items.value = [];
    sync.schedule(500);
  }

  /** Finish the current session (practice or mock) and clear it from the screen state. */
  async function finish(): Promise<FinishSummary | null> {
    const s = session.value;
    if (!s) return null;
    const summary = await endSession({ ...plain(s) });
    session.value = null;
    items.value = [];
    return summary;
  }

  // ---- analytics inputs ------------------------------------------------------------------------

  async function pipelineFor(bank: string) {
    const ids = await source().ids(bank);
    const prog = await progressMap(bank);
    return pipeline([...prog.values()], ids.length);
  }

  /**
   * When the earliest not-yet-due card comes back, as an epoch ms — or null if nothing is waiting.
   * Leeches are excluded because they are never scheduled by `scheduleSession`; they are drilled.
   * This is what lets the idle screen say "your next batch unlocks in 4 hours" instead of implying
   * the app has run out of content.
   */
  async function nextDueAt(now = Date.now()): Promise<number | null> {
    const prog = await progressMap();
    let soonest: number | null = null;
    for (const p of prog.values()) {
      if (p.attempts === 0 || p.leech || p.dueAt <= now) continue;
      if (soonest == null || p.dueAt < soonest) soonest = p.dueAt;
    }
    return soonest;
  }
  async function coverageFor(bank: string) {
    const bp = await blueprint(bank);
    if (!bp) return null;
    const list = await source().get(await source().ids(bank));
    const nodes = new Map(list.map((i) => [i.id, i.blueprint_node]));
    return coverage(bp, nodes, await progressMap(bank), licenseLevel());
  }
  async function readinessFor(bank: string, portion: "national" | "state") {
    const bp = await blueprint(bank);
    const st = await state();
    if (!bp || !st) return null;
    const exam = licenseLevel() === "broker" && st.broker_exam ? st.broker_exam : st.salesperson_exam;
    const scored = portion === "national" ? exam.national_items ?? bp.exams.salesperson.scored_items : exam.state_items ?? exam.total_items ?? bp.exams.salesperson.scored_items;
    const pass = portion === "national" ? exam.pass_score_national ?? exam.pass_score_combined : exam.pass_score_state ?? exam.pass_score_combined;
    const prog = [...(await progressMap(bank)).values()];
    return readiness(bp, prog, { portion, scoredItems: scored!, passThreshold: passItemsFrom(pass, scored!), exam: licenseLevel() });
  }
  async function missedQueue(): Promise<Progress[]> {
    return (await repo.allProgress()).filter((p) => p.box === "red" || p.leech).sort((a, b) => b.misses - a.misses);
  }

  return {
    // V2 §6.1
    startPractice, startMock, resume, answer, next, goTo, finish, discard, current, session, items, progressFor, activeSession, history, loadHistory,
    // shared with the analytics composables and the pre-V2 pages
    state, banks, blueprint, getItems, startSession, saveSession, endSession, pipelineFor, coverageFor, readinessFor, missedQueue, nextDueAt, mode, version, seedCache,
    get source() { return source(); },
  };
}
