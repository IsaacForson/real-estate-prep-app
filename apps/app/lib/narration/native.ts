/**
 * `NativeNarrationPlayer` — wraps the recommended Capacitor plugin:
 *
 *   @mediagrid/capacitor-native-audio  v3.0.0 (2026-01-23), peer @capacitor/core >= 8, MIT
 *   https://github.com/mediagrid/capacitor-native-audio
 *
 *   import { AudioPlayer } from '@mediagrid/capacitor-native-audio';
 *
 * Why this plugin (see docs/AUDIO_SPIKE.md §2): iOS uses AVPlayer with
 * AVAudioSession `.playback`/`.spokenAudio`, MPNowPlayingInfoCenter and
 * MPRemoteCommandCenter; Android uses Media3 ExoPlayer inside a
 * `MediaSessionService` foreground service (`foregroundServiceType=
 * "mediaPlayback"`), which is exactly what Android 14+ requires and what the
 * Android 17 "background audio hardening" change recommends.
 *
 * The plugin is imported by the app and injected here (constructor argument)
 * so this module has no dependency on `@capacitor/core` or the plugin and can
 * be type-checked/tested standalone. `MediagridAudioPlayerPlugin` below is a
 * local copy of the plugin's `AudioPlayerPlugin` interface (src/definitions.ts
 * at v3.0.0) — keep it in sync when bumping the plugin.
 *
 * Known gaps in the plugin (each is flagged where it matters):
 *  1. No queue. The queue lives here; one plugin "audio source" per track,
 *     destroyed when the track ends. Not gapless — fine for spoken items.
 *  2. No next/previous remote commands. The lock screen shows skip-back /
 *     skip-forward interval buttons (default 5 s; we set 15 s) instead of
 *     previous/next track. Options: (a) accept (items are short, seek is
 *     useful), (b) small fork adding `nextTrackCommand`/`previousTrackCommand`
 *     (iOS) and `COMMAND_SEEK_TO_NEXT/PREVIOUS_MEDIA_ITEM` (Android) that
 *     emit a status the JS layer maps to next()/previous(). The web player
 *     (player.ts) supports next/previous natively via the Media Session API.
 *  3. No progress event. Position is polled every `persistIntervalMs` while
 *     playing (a plugin call ~1/s is cheap).
 *  4. iOS `setRate` uses `AVPlayer.rate` with the default
 *     `audioTimePitchAlgorithm` (`lowQualityZeroLatency`), which SNAPS the
 *     rate to {0.5, 0.67, 0.8, 1.0, 1.25, 1.5, 2.0}. 0.75× and 2.5× will not
 *     be honoured until the plugin (or our fork) sets
 *     `playerItem.audioTimePitchAlgorithm = .timeDomain`. Device checklist
 *     item V3 tests exactly this. Android `setPlaybackSpeed` is fine.
 *  5. `audioSource` must be a URL string. Use `https://…` or a `file://…` URI
 *     from `@capacitor/filesystem` `getUri()`. Bare paths are rejected.
 */

import { BaseNarrationPlayer } from "./player";
import { clampRate, type NarrationPlayerOptions, type NarrationTrack } from "./types";

// ---- Local mirror of @mediagrid/capacitor-native-audio's definitions.ts (v3.0.0) ----

export interface MediagridDefaultParams {
  audioId: string;
}

export interface MediagridPrepareParams extends MediagridDefaultParams {
  audioSource: string;
  albumTitle?: string;
  artistName?: string;
  friendlyTitle: string;
  useForNotification: boolean;
  artworkSource?: string;
  isBackgroundMusic?: boolean;
  loop?: boolean;
  showSeekBackward?: boolean;
  showSeekForward?: boolean;
  seekBackwardTime?: number;
  seekForwardTime?: number;
  metadataUpdateUrl?: string;
  metadataUpdateInterval?: number;
}

export interface MediagridListenerResult {
  callbackId: string;
}

export type MediagridPlaybackStatus = "playing" | "paused" | "stopped";

/** Subset of the plugin's `AudioPlayerPlugin` this player uses. Structurally compatible with the real export. */
export interface MediagridAudioPlayerPlugin {
  create(params: MediagridPrepareParams): Promise<{ success: boolean }>;
  initialize(params: MediagridDefaultParams): Promise<{ success: boolean }>;
  changeAudioSource(params: MediagridDefaultParams & { source: string }): Promise<void>;
  changeMetadata(
    params: MediagridDefaultParams & {
      albumTitle?: string;
      artistName?: string;
      friendlyTitle?: string;
      artworkSource?: string;
    },
  ): Promise<void>;
  getDuration(params: MediagridDefaultParams): Promise<{ duration: number }>;
  getCurrentTime(params: MediagridDefaultParams): Promise<{ currentTime: number }>;
  play(params: MediagridDefaultParams): Promise<void>;
  pause(params: MediagridDefaultParams): Promise<void>;
  seek(params: MediagridDefaultParams & { timeInSeconds: number }): Promise<void>;
  stop(params: MediagridDefaultParams): Promise<void>;
  setVolume(params: MediagridDefaultParams & { volume: number }): Promise<void>;
  setRate(params: MediagridDefaultParams & { rate: number }): Promise<void>;
  isPlaying(params: MediagridDefaultParams): Promise<{ isPlaying: boolean }>;
  destroy(params: MediagridDefaultParams): Promise<void>;
  onAppGainsFocus(params: MediagridDefaultParams, callback: () => void): Promise<MediagridListenerResult>;
  onAppLosesFocus(params: MediagridDefaultParams, callback: () => void): Promise<MediagridListenerResult>;
  onAudioReady(params: MediagridDefaultParams, callback: () => void): Promise<MediagridListenerResult>;
  onAudioEnd(params: MediagridDefaultParams, callback: () => void): Promise<MediagridListenerResult>;
  onPlaybackStatusChange(
    params: MediagridDefaultParams,
    callback: (result: { status: MediagridPlaybackStatus }) => void,
  ): Promise<MediagridListenerResult>;
}

export interface NativeNarrationOptions extends NarrationPlayerOptions {
  /** Lock-screen skip interval in seconds (plugin default 5). Default 15. */
  skipIntervalSeconds?: number;
  /** Poll interval for position while playing. Default = persistIntervalMs. */
  pollIntervalMs?: number;
}

export class NativeNarrationPlayer extends BaseNarrationPlayer {
  private plugin: MediagridAudioPlayerPlugin;
  private skipInterval: number;
  private pollIntervalMs: number;

  /** Plugin audio id for the currently created source, or null. */
  private audioId: string | null = null;
  /** Monotonic counter so stale callbacks from a destroyed source are ignored. */
  private generation = 0;
  private readyPromise: Promise<void> | null = null;
  private pendingStartMs = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastKnownPositionMs = 0;
  private lastKnownDurationMs: number | null = null;

  constructor(plugin: MediagridAudioPlayerPlugin, options: NativeNarrationOptions = {}) {
    super(options);
    this.plugin = plugin;
    this.skipInterval = options.skipIntervalSeconds ?? 15;
    this.pollIntervalMs = options.pollIntervalMs ?? this.persistIntervalMs;
  }

  async setQueue(tracks: readonly NarrationTrack[], startIndex = 0, startPositionMs = 0): Promise<void> {
    this.tracks = [...tracks];
    if (this.tracks.length === 0) {
      this.index = -1;
      await this.releaseSource();
      this.setState("idle");
      this.emit({ type: "trackchange", track: null, index: -1 });
      return;
    }
    await this.skipTo(Math.min(Math.max(0, startIndex), this.tracks.length - 1), startPositionMs);
  }

  async skipTo(index: number, positionMs = 0): Promise<void> {
    const track = this.tracks[index];
    if (!track) throw new RangeError(`No track at index ${index}`);
    await this.releaseSource();
    this.index = index;
    this.pendingStartMs = positionMs;
    this.lastKnownPositionMs = positionMs;
    this.lastKnownDurationMs = track.durationMs ?? null;
    this.setState("loading");
    this.emit({ type: "trackchange", track, index });

    const gen = ++this.generation;
    const audioId = `narration:${track.id}`;
    this.audioId = audioId;

    await this.plugin.create({
      audioId,
      audioSource: track.src,
      friendlyTitle: track.title,
      artistName: track.subtitle,
      albumTitle: this.albumTitle,
      artworkSource: track.artworkSrc ?? this.defaultArtworkSrc,
      useForNotification: true, // primary audio → Now Playing / media notification
      isBackgroundMusic: false,
      loop: false,
      showSeekBackward: true,
      showSeekForward: true,
      seekBackwardTime: this.skipInterval,
      seekForwardTime: this.skipInterval,
    });

    // Listeners must be registered before initialize() so we never miss onAudioReady.
    this.readyPromise = new Promise<void>((resolve) => {
      void this.plugin.onAudioReady({ audioId }, () => {
        if (gen !== this.generation) return;
        resolve();
      });
    });

    void this.plugin.onAudioEnd({ audioId }, () => {
      if (gen !== this.generation) return;
      this.stopPolling();
      void this.onTrackEnded();
    });

    // Fired for lock-screen / notification / headset / interruption (phone
    // call) changes as well as our own calls — keep our state mirrored.
    void this.plugin.onPlaybackStatusChange({ audioId }, ({ status }) => {
      if (gen !== this.generation) return;
      if (status === "playing" && this._state !== "playing") {
        this.setState("playing");
        this.startPolling();
      } else if (status === "paused" && this._state === "playing") {
        this.stopPolling();
        this.setState("paused");
        void this.snapshotPosition(true);
      } else if (status === "stopped" && this._state === "playing") {
        this.stopPolling();
        this.setState("paused");
      }
    });

    await this.plugin.initialize({ audioId });
    await this.readyPromise;
    if (gen !== this.generation) return; // superseded while loading

    await this.plugin.setRate({ audioId, rate: this._rate });
    if (this.pendingStartMs > 0) {
      await this.plugin.seek({ audioId, timeInSeconds: this.pendingStartMs / 1000 });
      this.pendingStartMs = 0;
    }
    try {
      const { duration } = await this.plugin.getDuration({ audioId });
      if (Number.isFinite(duration) && duration > 0) this.lastKnownDurationMs = duration * 1000;
    } catch {
      /* duration unknown until playing on some sources */
    }
    if (this._state === "loading") this.setState("paused");
  }

  async play(): Promise<void> {
    if (!this.audioId || !this.current) return;
    if (this.readyPromise) await this.readyPromise;
    if (this._state === "ended" && this.index + 1 >= this.tracks.length) {
      await this.plugin.seek({ audioId: this.audioId, timeInSeconds: 0 });
    }
    try {
      await this.plugin.play({ audioId: this.audioId });
      this.setState("playing");
      this.startPolling();
    } catch (error) {
      this.emit({ type: "error", trackId: this.current.id, error });
      this.setState("paused");
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (!this.audioId) return;
    this.stopPolling();
    await this.plugin.pause({ audioId: this.audioId });
    this.setState("paused");
    await this.snapshotPosition(true);
  }

  async seek(positionMs: number): Promise<void> {
    if (!this.audioId) return;
    const durationMs = this.lastKnownDurationMs;
    const clamped = Math.max(0, durationMs ? Math.min(positionMs, durationMs) : positionMs);
    await this.plugin.seek({ audioId: this.audioId, timeInSeconds: clamped / 1000 });
    this.lastKnownPositionMs = clamped;
    this.reportProgress(clamped, durationMs, true);
  }

  async setRate(rate: number): Promise<void> {
    this._rate = clampRate(rate);
    this.emit({ type: "ratechange", rate: this._rate });
    if (this.audioId) {
      // See header note 4: on iOS the plugin's AVPlayer may snap this value
      // until audioTimePitchAlgorithm is set to .timeDomain.
      await this.plugin.setRate({ audioId: this.audioId, rate: this._rate });
    }
  }

  async getPosition(): Promise<{ positionMs: number; durationMs: number | null }> {
    if (!this.audioId) return { positionMs: 0, durationMs: null };
    await this.snapshotPosition(false);
    return { positionMs: this.lastKnownPositionMs, durationMs: this.lastKnownDurationMs };
  }

  async destroy(): Promise<void> {
    await this.releaseSource();
    this.emitter.clear();
    this.setState("idle");
  }

  // ---- internals -----------------------------------------------------------

  private async releaseSource(): Promise<void> {
    this.stopPolling();
    this.generation++; // invalidate callbacks from the old source
    const id = this.audioId;
    this.audioId = null;
    this.readyPromise = null;
    if (!id) return;
    try {
      await this.plugin.stop({ audioId: id });
    } catch {
      /* already stopped */
    }
    try {
      await this.plugin.destroy({ audioId: id });
    } catch {
      /* already destroyed */
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      void this.snapshotPosition(false);
    }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** Read position (and duration if still unknown) from the plugin and report it. */
  private async snapshotPosition(force: boolean): Promise<void> {
    const id = this.audioId;
    if (!id) return;
    try {
      const { currentTime } = await this.plugin.getCurrentTime({ audioId: id });
      if (id !== this.audioId) return;
      this.lastKnownPositionMs = currentTime * 1000;
      if (this.lastKnownDurationMs === null) {
        const { duration } = await this.plugin.getDuration({ audioId: id });
        if (Number.isFinite(duration) && duration > 0) this.lastKnownDurationMs = duration * 1000;
      }
      this.reportProgress(this.lastKnownPositionMs, this.lastKnownDurationMs, force);
    } catch {
      /* source went away mid-poll */
    }
  }
}
