/**
 * `NarrationPlayer` interface + `WebNarrationPlayer` (HTML5 Audio + Media Session API).
 *
 * The web player is the primary implementation on the web product and the
 * fallback on native when the native plugin is unavailable. See
 * docs/AUDIO_SPIKE.md for why it is NOT sufficient for background playback
 * inside the iOS/Android WebView.
 *
 * No framework imports. `WebNarrationPlayer` takes an `AudioFactory` so it can
 * be unit-tested with a fake HTMLAudioElement.
 */

import {
  DEFAULT_OPTIONS,
  NarrationEmitter,
  canTransition,
  clampRate,
  type NarrationEvent,
  type NarrationListener,
  type NarrationPlayerOptions,
  type NarrationQueue,
  type NarrationState,
  type NarrationTrack,
  type PositionPersist,
} from "./types";

export interface NarrationPlayer {
  readonly state: NarrationState;
  readonly rate: number;
  readonly queue: NarrationQueue;
  readonly current: NarrationTrack | null;
  readonly autoAdvance: boolean;

  /**
   * Replace the queue and load `startIndex` (default 0) at `startPositionMs`
   * (default 0). Does not start playback; call `play()`.
   */
  setQueue(tracks: readonly NarrationTrack[], startIndex?: number, startPositionMs?: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  toggle(): Promise<void>;
  /** Advance to the next track. Resolves false if there is none. */
  next(): Promise<boolean>;
  /** Go to the previous track (or restart the current one if positionMs > 3000). */
  previous(): Promise<boolean>;
  /** Jump to an index in the queue. */
  skipTo(index: number, positionMs?: number): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setRate(rate: number): Promise<void>;
  setAutoAdvance(enabled: boolean): void;
  getPosition(): Promise<{ positionMs: number; durationMs: number | null }>;
  on(listener: NarrationListener): () => void;
  /** Stop playback, release resources, clear lock-screen metadata. */
  destroy(): Promise<void>;
}

/** The subset of HTMLAudioElement the web player relies on — fakeable in tests. */
export interface AudioLike {
  src: string;
  currentTime: number;
  readonly duration: number;
  playbackRate: number;
  preservesPitch?: boolean;
  preload: string;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  addEventListener(type: string, listener: (ev?: unknown) => void): void;
  removeEventListener(type: string, listener: (ev?: unknown) => void): void;
}

export type AudioFactory = () => AudioLike;

const defaultAudioFactory: AudioFactory = () => {
  if (typeof Audio === "undefined") {
    throw new Error("HTML5 Audio is not available in this environment");
  }
  return new Audio() as unknown as AudioLike;
};

type MediaSessionLike = {
  metadata: unknown;
  playbackState: "none" | "paused" | "playing";
  setActionHandler(action: string, handler: ((details: { seekTime?: number; seekOffset?: number }) => void) | null): void;
  setPositionState?(state?: { duration?: number; playbackRate?: number; position?: number }): void;
};

function getMediaSession(): MediaSessionLike | null {
  if (typeof navigator === "undefined") return null;
  const ms = (navigator as unknown as { mediaSession?: MediaSessionLike }).mediaSession;
  return ms ?? null;
}

/** Shared queue/option/state bookkeeping for all player implementations. */
export abstract class BaseNarrationPlayer implements NarrationPlayer {
  protected emitter = new NarrationEmitter();
  protected tracks: NarrationTrack[] = [];
  protected index = -1;
  protected _state: NarrationState = "idle";
  protected _rate: number;
  protected _autoAdvance: boolean;
  protected persist: PositionPersist | undefined;
  protected persistIntervalMs: number;
  protected albumTitle: string;
  protected defaultArtworkSrc: string | undefined;
  private lastPersistAt = 0;

  constructor(options: NarrationPlayerOptions = {}) {
    this._rate = clampRate(options.initialRate ?? DEFAULT_OPTIONS.initialRate);
    this._autoAdvance = options.autoAdvance ?? DEFAULT_OPTIONS.autoAdvance;
    this.persist = options.persistPosition;
    this.persistIntervalMs = options.persistIntervalMs ?? DEFAULT_OPTIONS.persistIntervalMs;
    this.albumTitle = options.albumTitle ?? DEFAULT_OPTIONS.albumTitle;
    this.defaultArtworkSrc = options.defaultArtworkSrc;
  }

  get state(): NarrationState {
    return this._state;
  }
  get rate(): number {
    return this._rate;
  }
  get autoAdvance(): boolean {
    return this._autoAdvance;
  }
  get queue(): NarrationQueue {
    return { tracks: this.tracks, index: this.index };
  }
  get current(): NarrationTrack | null {
    return this.tracks[this.index] ?? null;
  }

  on(listener: NarrationListener): () => void {
    return this.emitter.on(listener);
  }

  setAutoAdvance(enabled: boolean): void {
    this._autoAdvance = enabled;
  }

  async toggle(): Promise<void> {
    if (this._state === "playing") await this.pause();
    else await this.play();
  }

  async next(): Promise<boolean> {
    if (this.index + 1 >= this.tracks.length) return false;
    const wasPlaying = this._state === "playing";
    await this.skipTo(this.index + 1, 0);
    if (wasPlaying) await this.play();
    return true;
  }

  async previous(): Promise<boolean> {
    const { positionMs } = await this.getPosition();
    const wasPlaying = this._state === "playing";
    if (positionMs > 3000 || this.index <= 0) {
      await this.seek(0);
      return this.index > 0 || positionMs > 3000;
    }
    await this.skipTo(this.index - 1, 0);
    if (wasPlaying) await this.play();
    return true;
  }

  abstract setQueue(tracks: readonly NarrationTrack[], startIndex?: number, startPositionMs?: number): Promise<void>;
  abstract play(): Promise<void>;
  abstract pause(): Promise<void>;
  abstract skipTo(index: number, positionMs?: number): Promise<void>;
  abstract seek(positionMs: number): Promise<void>;
  abstract setRate(rate: number): Promise<void>;
  abstract getPosition(): Promise<{ positionMs: number; durationMs: number | null }>;
  abstract destroy(): Promise<void>;

  protected setState(next: NarrationState): void {
    const previous = this._state;
    if (previous === next) return;
    if (!canTransition(previous, next)) {
      // Do not throw — a bad transition from a late native callback must not
      // wedge the player. Log so tests can catch it.
      if (typeof console !== "undefined") console.warn(`[narration] unexpected transition ${previous} → ${next}`);
    }
    this._state = next;
    this.emitter.emit({ type: "statechange", state: next, previous });
  }

  protected emit(event: NarrationEvent): void {
    this.emitter.emit(event);
  }

  /** Throttled position persistence + progress event. `force` bypasses the throttle (pause/seek/track end). */
  protected reportProgress(positionMs: number, durationMs: number | null, force = false): void {
    const track = this.current;
    if (!track) return;
    this.emit({ type: "progress", trackId: track.id, positionMs, durationMs });
    const now = Date.now();
    if (force || now - this.lastPersistAt >= this.persistIntervalMs) {
      this.lastPersistAt = now;
      this.persist?.({ trackId: track.id, positionMs: Math.max(0, Math.round(positionMs)), durationMs });
    }
  }

  /** Called by implementations when the current track finishes. */
  protected async onTrackEnded(): Promise<void> {
    this.reportProgress(0, null, true); // finished → next resume starts at 0
    if (this._autoAdvance && this.index + 1 < this.tracks.length) {
      await this.skipTo(this.index + 1, 0);
      await this.play();
      return;
    }
    this.setState("ended");
    if (this.index + 1 >= this.tracks.length) this.emit({ type: "queueended" });
  }
}

/**
 * HTML5 `<audio>` + Media Session API implementation.
 *
 * - `playbackRate` 0.75–2.5 with `preservesPitch = true` (WebKit uses its
 *   time-domain algorithm, so non-snapped rates like 0.75 and 2.5 work).
 * - Queue with auto-advance; the next track is pre-created so the element swap
 *   is immediate (not gapless — acceptable for spoken items).
 * - Media Session metadata + action handlers for play/pause/next/previous/
 *   seekto/seekbackward/seekforward; position state for the lock-screen scrubber.
 * - Position persistence through `persistPosition` (throttled).
 */
export class WebNarrationPlayer extends BaseNarrationPlayer {
  private audio: AudioLike;
  private readonly createAudio: AudioFactory;
  private pendingStartMs = 0;
  private destroyed = false;
  private boundHandlers: Array<[string, (ev?: unknown) => void]> = [];

  constructor(options: NarrationPlayerOptions = {}, createAudio: AudioFactory = defaultAudioFactory) {
    super(options);
    this.createAudio = createAudio;
    this.audio = this.createAudio();
    this.audio.preload = "auto";
    this.attach(this.audio);
    this.installMediaSessionHandlers();
  }

  async setQueue(tracks: readonly NarrationTrack[], startIndex = 0, startPositionMs = 0): Promise<void> {
    this.tracks = [...tracks];
    if (this.tracks.length === 0) {
      this.index = -1;
      this.audio.pause();
      this.setState("idle");
      this.emit({ type: "trackchange", track: null, index: -1 });
      return;
    }
    await this.skipTo(Math.min(Math.max(0, startIndex), this.tracks.length - 1), startPositionMs);
  }

  async skipTo(index: number, positionMs = 0): Promise<void> {
    const track = this.tracks[index];
    if (!track) throw new RangeError(`No track at index ${index}`);
    this.index = index;
    this.pendingStartMs = positionMs;
    this.setState("loading");
    this.audio.pause();
    this.audio.src = track.src;
    this.audio.playbackRate = this._rate;
    this.audio.load();
    this.emit({ type: "trackchange", track, index });
    this.updateMetadata(track);
  }

  async play(): Promise<void> {
    if (!this.current) return;
    if (this._state === "ended" && this.index + 1 >= this.tracks.length) {
      // Replay from the start of the current (last) track.
      this.audio.currentTime = 0;
    }
    try {
      await this.audio.play();
      this.setState("playing");
      this.setSessionPlaybackState("playing");
    } catch (error) {
      // Autoplay policy or decode error. Surface it; stay paused.
      this.emit({ type: "error", trackId: this.current?.id ?? null, error });
      this.setState("paused");
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (!this.current) return;
    this.audio.pause();
    this.setState("paused");
    this.setSessionPlaybackState("paused");
    this.reportProgress(this.audio.currentTime * 1000, this.durationMs(), true);
  }

  async seek(positionMs: number): Promise<void> {
    const durationMs = this.durationMs();
    const clamped = Math.max(0, durationMs ? Math.min(positionMs, durationMs) : positionMs);
    this.audio.currentTime = clamped / 1000;
    this.reportProgress(clamped, durationMs, true);
    this.updatePositionState();
  }

  async setRate(rate: number): Promise<void> {
    this._rate = clampRate(rate);
    this.audio.playbackRate = this._rate;
    this.emit({ type: "ratechange", rate: this._rate });
    this.updatePositionState();
  }

  async getPosition(): Promise<{ positionMs: number; durationMs: number | null }> {
    return { positionMs: this.audio.currentTime * 1000, durationMs: this.durationMs() };
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.audio.pause();
    this.detach(this.audio);
    this.audio.src = "";
    const ms = getMediaSession();
    if (ms) {
      for (const action of ACTIONS) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* unsupported action */
        }
      }
      ms.metadata = null;
      ms.playbackState = "none";
    }
    this.emitter.clear();
    this.setState("idle");
  }

  // ---- internals -----------------------------------------------------------

  private durationMs(): number | null {
    const d = this.audio.duration;
    if (Number.isFinite(d) && d > 0) return d * 1000;
    return this.current?.durationMs ?? null;
  }

  private attach(audio: AudioLike): void {
    if (audio.preservesPitch !== undefined) audio.preservesPitch = true;
    const on = (type: string, fn: (ev?: unknown) => void) => {
      audio.addEventListener(type, fn);
      this.boundHandlers.push([type, fn]);
    };
    on("loadedmetadata", () => {
      if (this.pendingStartMs > 0) {
        audio.currentTime = this.pendingStartMs / 1000;
        this.pendingStartMs = 0;
      }
      this.updatePositionState();
    });
    on("canplay", () => {
      if (this._state === "loading") this.setState("paused");
    });
    on("playing", () => {
      if (this._state !== "playing") this.setState("playing");
      this.setSessionPlaybackState("playing");
    });
    on("pause", () => {
      // Fired by system interruptions (phone call) too — mirror it.
      if (this._state === "playing" && !this.destroyed) {
        this.setState("paused");
        this.setSessionPlaybackState("paused");
        this.reportProgress(audio.currentTime * 1000, this.durationMs(), true);
      }
    });
    on("timeupdate", () => {
      if (this._state === "playing") this.reportProgress(audio.currentTime * 1000, this.durationMs());
    });
    on("ratechange", () => this.updatePositionState());
    on("ended", () => {
      void this.onTrackEnded();
    });
    on("error", (ev) => {
      this.emit({ type: "error", trackId: this.current?.id ?? null, error: ev });
      if (this._state !== "idle") this.setState("paused");
    });
  }

  private detach(audio: AudioLike): void {
    for (const [type, fn] of this.boundHandlers) audio.removeEventListener(type, fn);
    this.boundHandlers = [];
  }

  private updateMetadata(track: NarrationTrack): void {
    const ms = getMediaSession();
    if (!ms) return;
    const artwork = track.artworkSrc ?? this.defaultArtworkSrc;
    const MediaMetadataCtor = (globalThis as unknown as { MediaMetadata?: new (init: unknown) => unknown }).MediaMetadata;
    if (!MediaMetadataCtor) return;
    ms.metadata = new MediaMetadataCtor({
      title: track.title,
      artist: track.subtitle ?? "",
      album: this.albumTitle,
      artwork: artwork ? [{ src: artwork, sizes: "512x512", type: "image/png" }] : [],
    });
    this.updatePositionState();
  }

  private setSessionPlaybackState(state: "playing" | "paused"): void {
    const ms = getMediaSession();
    if (ms) ms.playbackState = state;
    this.updatePositionState();
  }

  private updatePositionState(): void {
    const ms = getMediaSession();
    if (!ms?.setPositionState) return;
    const d = this.audio.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    try {
      ms.setPositionState({
        duration: d,
        playbackRate: this._rate,
        position: Math.min(this.audio.currentTime, d),
      });
    } catch {
      /* some browsers throw on out-of-range values; ignore */
    }
  }

  private installMediaSessionHandlers(): void {
    const ms = getMediaSession();
    if (!ms) return;
    const handlers: Record<string, (details: { seekTime?: number; seekOffset?: number }) => void> = {
      play: () => void this.play().catch(() => undefined),
      pause: () => void this.pause(),
      stop: () => void this.pause(),
      nexttrack: () => void this.next(),
      previoustrack: () => void this.previous(),
      seekto: (d) => {
        if (typeof d.seekTime === "number") void this.seek(d.seekTime * 1000);
      },
      seekbackward: (d) => void this.seek(this.audio.currentTime * 1000 - (d.seekOffset ?? 10) * 1000),
      seekforward: (d) => void this.seek(this.audio.currentTime * 1000 + (d.seekOffset ?? 10) * 1000),
    };
    for (const action of ACTIONS) {
      try {
        ms.setActionHandler(action, handlers[action] ?? null);
      } catch {
        /* action not supported by this UA */
      }
    }
  }
}

const ACTIONS = ["play", "pause", "stop", "nexttrack", "previoustrack", "seekto", "seekbackward", "seekforward"] as const;
