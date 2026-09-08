/**
 * Narration module entry point.
 *
 *   import { Capacitor } from '@capacitor/core';
 *   import { AudioPlayer } from '@mediagrid/capacitor-native-audio';
 *   import { createNarrationPlayer } from '~/lib/narration';
 *
 *   const player = createNarrationPlayer({
 *     capacitor: Capacitor,
 *     nativePlugin: AudioPlayer,
 *     persistPosition: (p) => progressStore.saveAudioPosition(p),
 *   });
 *
 * The choice is `Capacitor.isNativePlatform()` → NativeNarrationPlayer,
 * otherwise WebNarrationPlayer. Both are passed in by the app so this module
 * stays free of `@capacitor/core` and can be unit-tested in Node/vitest. If
 * `capacitor` is omitted we fall back to the `window.Capacitor` global the
 * Capacitor runtime injects into the WebView.
 */

import { NativeNarrationPlayer, type MediagridAudioPlayerPlugin, type NativeNarrationOptions } from "./native";
import { WebNarrationPlayer, type AudioFactory, type NarrationPlayer } from "./player";
import { SpeechNarrationPlayer, isSpeechSynthesisAvailable, type SpeechNarrationOptions } from "./tts-fallback";
import type { NarrationPlayerOptions } from "./types";

export * from "./types";
export * from "./player";
export * from "./native";
export * from "./tts-fallback";

/** The two members of `@capacitor/core`'s `Capacitor` object we care about. */
export interface CapacitorLike {
  isNativePlatform(): boolean;
  getPlatform?(): string;
  /** Converts a device file path to a URL the WebView may load. Needed only for the web player on native. */
  convertFileSrc?(filePath: string): string;
}

export interface CreateNarrationPlayerOptions extends NarrationPlayerOptions, NativeNarrationOptions {
  /** `Capacitor` from `@capacitor/core`. Defaults to `globalThis.Capacitor`. */
  capacitor?: CapacitorLike;
  /** `AudioPlayer` from `@mediagrid/capacitor-native-audio`. Required for the native path. */
  nativePlugin?: MediagridAudioPlayerPlugin;
  /** Force an implementation (tests, feature flags, the "audio engine" debug toggle). */
  force?: "web" | "native";
  /** Test seam for the web player. */
  audioFactory?: AudioFactory;
}

function detectCapacitor(): CapacitorLike | undefined {
  const g = globalThis as unknown as { Capacitor?: CapacitorLike };
  return g.Capacitor && typeof g.Capacitor.isNativePlatform === "function" ? g.Capacitor : undefined;
}

export function isNativePlatform(capacitor: CapacitorLike | undefined = detectCapacitor()): boolean {
  try {
    return capacitor?.isNativePlatform() ?? false;
  } catch {
    return false;
  }
}

/**
 * Create the right player for the current platform.
 *
 * On native without `nativePlugin` we fall back to the web player and warn:
 * playback will work in the foreground but NOT in the background / on the
 * lock screen (see docs/AUDIO_SPIKE.md).
 */
export function createNarrationPlayer(options: CreateNarrationPlayerOptions = {}): NarrationPlayer {
  const { capacitor, nativePlugin, force, audioFactory, ...playerOptions } = options;
  const native = force ? force === "native" : isNativePlatform(capacitor ?? detectCapacitor());

  if (native) {
    if (nativePlugin) return new NativeNarrationPlayer(nativePlugin, playerOptions);
    if (typeof console !== "undefined") {
      console.warn(
        "[narration] Native platform but no nativePlugin supplied — falling back to HTML5 audio. " +
          "Background and lock-screen playback will not work.",
      );
    }
  }
  return new WebNarrationPlayer(playerOptions, audioFactory);
}

/**
 * Create the on-device TTS fallback for tracks that have `text` but no
 * pre-generated `src`. Returns null when SpeechSynthesis is unavailable
 * (notably Android WebView) so the caller can show "audio not available yet".
 */
export function createTtsFallbackPlayer(options: SpeechNarrationOptions = {}): SpeechNarrationPlayer | null {
  if (!isSpeechSynthesisAvailable()) return null;
  return new SpeechNarrationPlayer(options);
}

/**
 * Convert a cached device path into something the WEB player can load on
 * native (`capacitor://localhost/_capacitor_file_/…`). The native player wants
 * the raw `file://` URI instead — do not convert for it.
 */
export function toWebPlayableSrc(src: string, capacitor: CapacitorLike | undefined = detectCapacitor()): string {
  if (src.startsWith("file://") && capacitor?.convertFileSrc) return capacitor.convertFileSrc(src);
  return src;
}
