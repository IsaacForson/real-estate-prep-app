/**
 * Wire shapes for the V2 edge functions the client calls (docs/V2_PLAN.md §3, §6.3). WP-A owns the
 * implementations; these types are the client's reading of the contract. Where the plan leaves a
 * response shape open (mock-start, support, help-ai) the parser below is deliberately tolerant.
 */
import type { IssueBatchResponse } from "../study/itemSource.js";

// ---- mock-start / mock-finish ---------------------------------------------------------------

/** `mock-start { form_id, jurisdiction }` → a server-built session (V2 §6.3). */
export interface MockStartResponse {
  session_id: string;
  form_id: string;
  jurisdiction: string;
  /** public ids in presentation order */
  item_ids: string[];
  time_limit_s: number | null;
  portions?: Array<{ portion: "national" | "state"; bank: string; item_ids: string[]; pass_score: string | null }>;
  /** optional signed batch carrying the items so the client need not call issue-batch */
  batch?: IssueBatchResponse | null;
  free_tier?: { remaining: number; total: number; mocks_remaining?: number } | null;
}

export function parseMockStart(x: unknown): MockStartResponse | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const s = (r.session && typeof r.session === "object" ? (r.session as Record<string, unknown>) : r);
  const id = typeof s.session_id === "string" ? s.session_id : typeof s.id === "string" ? s.id : null;
  const ids = Array.isArray(s.item_ids) ? s.item_ids.filter((v): v is string => typeof v === "string") : Array.isArray(s.public_ids) ? (s.public_ids as unknown[]).filter((v): v is string => typeof v === "string") : [];
  if (!id || !ids.length) return null;
  const portions = Array.isArray(s.portions)
    ? (s.portions as Array<Record<string, unknown>>).filter((p) => p && typeof p.bank === "string").map((p) => ({
        portion: p.portion === "national" ? "national" as const : "state" as const,
        bank: p.bank as string,
        item_ids: Array.isArray(p.item_ids) ? (p.item_ids as unknown[]).filter((v): v is string => typeof v === "string") : [],
        pass_score: typeof p.pass_score === "string" ? p.pass_score : null,
      }))
    : undefined;
  return {
    session_id: id,
    form_id: typeof s.form_id === "string" ? s.form_id : "",
    jurisdiction: typeof s.jurisdiction === "string" ? s.jurisdiction : "",
    item_ids: ids,
    time_limit_s: typeof s.time_limit_s === "number" ? s.time_limit_s : typeof s.time_limit_minutes === "number" ? s.time_limit_minutes * 60 : null,
    portions,
    batch: r.batch && typeof r.batch === "object" ? (r.batch as IssueBatchResponse) : null,
    free_tier: r.free_tier && typeof r.free_tier === "object" ? (r.free_tier as MockStartResponse["free_tier"]) : null,
  };
}

/** `mock-finish { session_id, answers }` → score. */
export interface MockFinishResponse {
  session_id: string;
  score: number;
  correct: number;
  total: number;
  passed: boolean | null;
  portions?: Array<{ portion: string; correct: number; total: number; passed: boolean | null }>;
}

// ---- support ----------------------------------------------------------------------------------

export type TicketStatus = "open" | "answered" | "closed";
export interface SupportMessage { id: string; ticket_id: string; author: "user" | "admin"; body: string; created_at: string }
export interface SupportTicket {
  id: string;
  subject: string;
  status: TicketStatus;
  category: string | null;
  created_at: string;
  updated_at: string;
  messages: SupportMessage[];
}

export function parseTicket(x: unknown): SupportTicket | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  const msgs = Array.isArray(r.messages) ? (r.messages as Array<Record<string, unknown>>).filter((m) => m && typeof m.body === "string").map((m) => ({
    id: String(m.id ?? ""), ticket_id: r.id as string, author: m.author === "admin" ? "admin" as const : "user" as const, body: m.body as string, created_at: String(m.created_at ?? ""),
  })) : [];
  return {
    id: r.id,
    subject: typeof r.subject === "string" ? r.subject : "",
    status: r.status === "answered" || r.status === "closed" ? r.status : "open",
    category: typeof r.category === "string" ? r.category : null,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? r.created_at ?? ""),
    messages: msgs,
  };
}

// ---- help --------------------------------------------------------------------------------------

/** One entry of `public/content/help.json` (built by scripts/build-help-kb.ts, WP-E). */
export interface HelpArticle {
  id: string;
  /** url segment for /help/<slug>; equals `id` */
  slug: string;
  title: string;
  body: string;
  /** e.g. "Getting started", "Billing" (`section` is the same value) */
  category: string | null;
  section?: string;
  tags?: string[];
  /** repo doc or page the entry came from */
  source?: string;
}

export function parseHelpKb(x: unknown): HelpArticle[] {
  const rows = Array.isArray(x) ? x : x && typeof x === "object" && Array.isArray((x as { articles?: unknown }).articles) ? (x as { articles: unknown[] }).articles : [];
  const out: HelpArticle[] = [];
  rows.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title : typeof r.question === "string" ? r.question : null;
    const body = typeof r.body === "string" ? r.body : typeof r.answer === "string" ? r.answer : typeof r.content === "string" ? r.content : null;
    if (!title || !body) return;
    const id = typeof r.id === "string" ? r.id : typeof r.slug === "string" ? r.slug : `help-${i}`;
    const category = typeof r.section === "string" ? r.section : typeof r.category === "string" ? r.category : null;
    out.push({
      id, slug: typeof r.slug === "string" ? r.slug : id,
      title, body,
      category,
      section: category ?? undefined,
      tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t): t is string => typeof t === "string") : undefined,
      source: typeof r.source === "string" ? r.source : typeof r.url === "string" ? r.url : undefined,
    });
  });
  return out;
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "it", "my", "i", "do", "how", "can", "what", "for", "with", "me"]);
export function tokenize(q: string): string[] {
  return q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Small ranked search: title hits weigh 3, tag hits 2, body hits 1, phrase match bonus. An empty query browses everything. */
export function searchHelp(kb: HelpArticle[], q: string, limit = 8): HelpArticle[] {
  if (!q.trim()) return kb.slice();
  const terms = tokenize(q);
  if (!terms.length) return [];
  const phrase = q.trim().toLowerCase();
  const scored = kb.map((a) => {
    const title = a.title.toLowerCase(), body = a.body.toLowerCase(), tags = (a.tags ?? []).join(" ").toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 3;
      if (tags.includes(t)) score += 2;
      if (body.includes(t)) score += 1;
    }
    if (phrase.length > 3 && (title.includes(phrase) || body.includes(phrase))) score += 4;
    return { a, score };
  }).filter((x) => x.score > 0).sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map((x) => x.a);
}

/** `help-ai { question, context? }` → `{ answer, sources }`. */
export interface HelpAiResponse { answer: string; sources: string[] }

// ---- reviews / coupons -------------------------------------------------------------------------

export interface Review {
  id: string;
  user_id?: string;
  rating: number;
  body: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  jurisdiction: string | null;
  /** display name the server attaches to approved reviews (first name + state), when it does */
  author: string | null;
}

export function parseReview(x: unknown): Review | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== "string" && typeof r.id !== "number") return null;
  const rating = Number(r.rating);
  if (!Number.isFinite(rating)) return null;
  return {
    id: String(r.id),
    user_id: typeof r.user_id === "string" ? r.user_id : undefined,
    rating: Math.min(5, Math.max(1, Math.round(rating))),
    body: typeof r.body === "string" ? r.body : "",
    status: r.status === "approved" || r.status === "rejected" ? r.status : "pending",
    created_at: typeof r.created_at === "string" ? r.created_at : new Date(0).toISOString(),
    jurisdiction: typeof r.jurisdiction === "string" ? r.jurisdiction : null,
    author: typeof r.author === "string" ? r.author : typeof r.display_name === "string" ? r.display_name : null,
  };
}

export interface RedeemCouponResponse { ok: boolean; product?: string; kind?: "percent" | "amount" | "gift"; error?: string }

// ---- free tier ---------------------------------------------------------------------------------

/** `free_tier_usage(scope, scope_id, jurisdiction, questions_used, mocks_used, updated_at)` (V2 §2). */
export interface FreeTierUsageRow {
  scope: "user" | "device";
  scope_id: string;
  jurisdiction: string | null;
  questions_used: number;
  mocks_used: number;
  updated_at?: string;
}

/** A device inherits the maximum of the per-user and per-device counters (V2 §1). */
export function maxUsage(rows: FreeTierUsageRow[]): { questionsUsed: number; mocksUsed: number; jurisdiction: string | null } {
  let questionsUsed = 0, mocksUsed = 0, jurisdiction: string | null = null;
  for (const r of rows) {
    questionsUsed = Math.max(questionsUsed, Number(r.questions_used) || 0);
    mocksUsed = Math.max(mocksUsed, Number(r.mocks_used) || 0);
    if (!jurisdiction && r.jurisdiction) jurisdiction = r.jurisdiction;
  }
  return { questionsUsed, mocksUsed, jurisdiction };
}
