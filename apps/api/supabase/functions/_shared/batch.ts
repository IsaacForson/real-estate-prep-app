/**
 * Batch composition (SPEC §5.4), pure. Given the sql candidates (due reviews + unseen look-ahead)
 * and the account's canary ids, produce the ordered list of item ids for one batch.
 */
import { BATCH_DEFAULT, BATCH_MAX, BATCH_MIN, CANARIES_PER_BATCH, CANARY_MIN_BATCH_SIZE } from "./limits.ts";

export interface Candidate {
  item_id: string;
  blueprint_node: string;
  cognitive_level: string;
  source: "due" | "new";
  box: "red" | "yellow" | "green" | null;
  due_at: string | null;
}

export interface SizeOptions {
  min?: number;
  max?: number;
  fallback?: number;
  /** hard cap from the free tier (remaining of 40) — may go below `min`. */
  cap?: number | null;
}

/** Clamp a requested size into [min, max], then apply an optional hard cap. */
export function clampBatchSize(requested: unknown, opts: SizeOptions = {}): number {
  const min = opts.min ?? BATCH_MIN;
  const max = opts.max ?? BATCH_MAX;
  const fallback = opts.fallback ?? BATCH_DEFAULT;
  let n = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : fallback;
  n = Math.min(max, Math.max(min, n));
  if (opts.cap !== undefined && opts.cap !== null) n = Math.min(n, Math.max(0, opts.cap));
  return n;
}

const BOX_RANK: Record<string, number> = { red: 0, yellow: 1, green: 2 };

/** Due items: red before yellow before green, then oldest due first. */
export function orderDue(due: Candidate[]): Candidate[] {
  return [...due].sort((a, b) => {
    const r = (BOX_RANK[a.box ?? "green"] ?? 2) - (BOX_RANK[b.box ?? "green"] ?? 2);
    if (r !== 0) return r;
    return (Date.parse(a.due_at ?? "") || 0) - (Date.parse(b.due_at ?? "") || 0);
  });
}

/** Round-robin across blueprint nodes so a batch is not 100 items from one subtopic. */
export function interleaveByNode(fresh: Candidate[], rng: () => number = Math.random): Candidate[] {
  const buckets = new Map<string, Candidate[]>();
  for (const c of shuffle(fresh, rng)) {
    const list = buckets.get(c.blueprint_node) ?? [];
    list.push(c);
    buckets.set(c.blueprint_node, list);
  }
  const keys = shuffle([...buckets.keys()], rng);
  const out: Candidate[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const k of keys) {
      const next = buckets.get(k)!.shift();
      if (next) {
        out.push(next);
        progressed = true;
      }
    }
  }
  return out;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface SelectParams {
  due: Candidate[];
  fresh: Candidate[];
  canaries: string[];
  size: number;
  rng?: () => number;
}

export interface Selection {
  item_ids: string[];
  due_count: number;
  new_count: number;
  canary_count: number;
}

/**
 * Compose the batch: all due reviews first (up to size), fill with interleaved fresh items,
 * then swap in up to CANARIES_PER_BATCH canaries at random positions (only when the batch is
 * big enough for a canary not to stand out). Never returns duplicates.
 */
export function selectBatchItems(p: SelectParams): Selection {
  const rng = p.rng ?? Math.random;
  const size = Math.max(0, Math.floor(p.size));
  const seen = new Set<string>();
  const picked: string[] = [];
  let dueCount = 0;
  let newCount = 0;

  for (const c of orderDue(p.due)) {
    if (picked.length >= size) break;
    if (seen.has(c.item_id)) continue;
    seen.add(c.item_id);
    picked.push(c.item_id);
    dueCount++;
  }
  for (const c of interleaveByNode(p.fresh, rng)) {
    if (picked.length >= size) break;
    if (seen.has(c.item_id)) continue;
    seen.add(c.item_id);
    picked.push(c.item_id);
    newCount++;
  }

  let canaryCount = 0;
  if (picked.length >= CANARY_MIN_BATCH_SIZE && p.canaries.length > 0) {
    const pool = shuffle(p.canaries.filter((c) => !seen.has(c)), rng).slice(0, CANARIES_PER_BATCH);
    for (const c of pool) {
      // replace a fresh item near the end rather than growing past `size`.
      const pos = Math.floor(rng() * picked.length);
      seen.add(c);
      picked.splice(pos, 0, c);
      canaryCount++;
    }
    while (picked.length > size) {
      // drop from the tail, but never a canary or a due item.
      const idx = findDroppable(picked, p.canaries, dueCount);
      if (idx < 0) break;
      picked.splice(idx, 1);
      newCount--;
    }
  }

  return { item_ids: picked, due_count: dueCount, new_count: newCount, canary_count: canaryCount };
}

function findDroppable(picked: string[], canaries: string[], dueCount: number): number {
  const canary = new Set(canaries);
  for (let i = picked.length - 1; i >= dueCount; i--) {
    if (!canary.has(picked[i]!)) return i;
  }
  return -1;
}

/** Seeded prng for deterministic tests (mulberry32). */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
