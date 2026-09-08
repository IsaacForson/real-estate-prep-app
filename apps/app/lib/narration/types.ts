/**
 * Narration (F6) — shared types.
 *
 * Framework-agnostic: no Nuxt/Vue/Capacitor imports. Everything the UI layer
 * needs to drive audio narration of questions, options, explanations and
 * flashcards is expressed here so the web, native and TTS players are
 * interchangeable behind one `NarrationPlayer` interface (see player.ts).
 */

/** Speed limits from SPEC §4.2 F6. */
export const MIN_RATE = 0.75;
export const MAX_RATE = 2.5;
export const DEFAULT_RATE = 1.0;

/** Clamp a requested rate into the supported range and round to 2 dp. */
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_RATE;
  const r = Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
  return Math.round(r * 100) / 100;
}

/**
 * One playable unit. In practice one track = one pre-generated asset
 * (`audio/<item_id>/v<version>/stem.mp3`, `.../opt-b.mp3`, `.../full.mp3`,
 * a flashcard, a glossary term, …).
 */
export interface NarrationTrack {
  /** Stable id, e.g. `FL-475-0413:v3:stem`. Used for position persistence. */
  id: string;
  /** Lock-screen title, e.g. "Question 12 of 40". */
  title: string;
  /** Lock-screen subtitle/artist line, e.g. "Florida · Agency and Disclosure". */
  subtitle?: string;
  /**
   * Playable source. `https://…` for remote, `file://…` for a cached file on
   * device, or an app-relative path on web. The web player expects a URL the
   * WebView can load (on native, run cached paths through
   * `Capacitor.convertFileSrc` before handing them to the web player; the
   * native player takes the raw `file://` URI).
   */
  src: string;
  /** Known duration, if the asset manifest has it. Lets the UI render a scrubber before metadata loads. */
  durationMs?: number;
  /** Square artwork for the lock screen (PNG, ≥ 512px). */
  artworkSrc?: string;
  /**
   * Plain text of what the asset says. Only needed for the on-device TTS
   * fallback (tts-fallback.ts) when no pre-generated asset exists.
   */
  text?: string;
}

/**
 * Player lifecycle.
 *
 *   idle ──setQueue──▶ loading ──canplay──▶ playing ◀──▶ paused
 *                          ▲                   │
 *                          │                   └──ended (last track, or autoAdvance off)──▶ ended
 *                          └── next()/previous()/track ended with autoAdvance ─────────────┘
 */
export type NarrationState = "idle" | "loading" | "playing" | "paused" | "ended";

/** Legal state transitions. Used by players to assert they are not corrupting state. */
export const TRANSITIONS: Readonly<Record<NarrationState, readonly NarrationState[]>> = {
  idle: ["loading"],
  loading: ["playing", "paused", "idle", "ended"],
  playing: ["paused", "loading", "ended", "idle"],
  paused: ["playing", "loading", "ended", "idle"],
  ended: ["loading", "idle", "playing"],
};

export function canTransition(from: NarrationState, to: NarrationState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export interface NarrationQueue {
  tracks: readonly NarrationTrack[];
  /** Index of the current track, or -1 when the queue is empty. */
  index: number;
}

export interface NarrationPosition {
  trackId: string;
  positionMs: number;
  durationMs: number | null;
}

/** Called (throttled) so the app can persist position per track — F8 "never lose progress". */
export type PositionPersist = (position: NarrationPosition) => void;

export type NarrationEvent =
  | { type: "statechange"; state: NarrationState; previous: NarrationState }
  | { type: "trackchange"; track: NarrationTrack | null; index: number }
  | { type: "progress"; trackId: string; positionMs: number; durationMs: number | null }
  | { type: "ratechange"; rate: number }
  | { type: "queueended" }
  | { type: "error"; trackId: string | null; error: unknown };

export type NarrationListener = (event: NarrationEvent) => void;

export interface NarrationPlayerOptions {
  /** Hands-free mode: when a track ends, play the next one. Default true. */
  autoAdvance?: boolean;
  /** Initial playback rate (clamped to 0.75–2.5). Default 1. */
  initialRate?: number;
  /** Position persistence callback. */
  persistPosition?: PositionPersist;
  /** Minimum interval between persistPosition calls while playing. Default 1000 ms. */
  persistIntervalMs?: number;
  /** Default artwork when a track has none. */
  defaultArtworkSrc?: string;
  /** Shown as the "album" on lock screens. Default "Real Estate Exam Prep". */
  albumTitle?: string;
}

export const DEFAULT_OPTIONS: Required<Omit<NarrationPlayerOptions, "persistPosition" | "defaultArtworkSrc">> = {
  autoAdvance: true,
  initialRate: DEFAULT_RATE,
  persistIntervalMs: 1000,
  albumTitle: "Real Estate Exam Prep",
};

/** Minimal emitter shared by all players. */
export class NarrationEmitter {
  private listeners = new Set<NarrationListener>();

  on(listener: NarrationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: NarrationEvent): void {
    for (const l of Array.from(this.listeners)) {
      try {
        l(event);
      } catch (err) {
        // A misbehaving listener must not break playback.
        if (typeof console !== "undefined") console.error("[narration] listener threw", err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
