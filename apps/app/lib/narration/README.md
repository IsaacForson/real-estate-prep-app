# `lib/narration` — audio narration (F6)

Framework-agnostic TypeScript for narrating questions, options, explanations,
flashcards and glossary terms. No Nuxt/Vue/Capacitor imports; every platform
dependency is injected so the module type-checks and unit-tests in Node.

Background research, the go/no-go decision and the device validation checklist
live in [`docs/AUDIO_SPIKE.md`](../../../../docs/AUDIO_SPIKE.md).

## Files

| File | What it is |
| --- | --- |
| `types.ts` | `NarrationTrack`, `NarrationQueue`, state machine (`idle → loading → playing ⇄ paused → ended`), events, options, rate limits (0.75–2.5). |
| `player.ts` | `NarrationPlayer` interface, `BaseNarrationPlayer` (queue/auto-advance/persistence shared by all players) and `WebNarrationPlayer` — HTML5 `<audio>` + Media Session API. |
| `native.ts` | `NativeNarrationPlayer` wrapping [`@mediagrid/capacitor-native-audio`](https://github.com/mediagrid/capacitor-native-audio) (v3.0.0, Capacitor 8). Carries a local mirror of the plugin's TS interface so nothing here imports the package. |
| `tts-fallback.ts` | `SpeechNarrationPlayer` — on-device `SpeechSynthesis`, sentence-chunked so pause/resume never loses more than one sentence. Foreground-only. |
| `index.ts` | `createNarrationPlayer()` picks native vs web via `Capacitor.isNativePlatform()`; `createTtsFallbackPlayer()`; `toWebPlayableSrc()`. |

## Usage (Nuxt side, not in this module)

```ts
// app/composables/useNarration.ts
import { Capacitor } from "@capacitor/core";
import { AudioPlayer } from "@mediagrid/capacitor-native-audio";
import { createNarrationPlayer, type NarrationTrack } from "~/lib/narration";

const player = createNarrationPlayer({
  capacitor: Capacitor,
  nativePlugin: AudioPlayer,
  autoAdvance: true,
  initialRate: settings.audioRate,
  persistPosition: (p) => progress.saveAudioPosition(p), // F8: per-track resume
  defaultArtworkSrc: "https://cdn.example.com/artwork/app-512.png",
});

const tracks: NarrationTrack[] = [
  { id: "FL-475-0413:v3:stem", title: "Question 12 of 40", subtitle: "Florida · Agency", src: uri("audio/FL-475-0413/v3/stem.mp3") },
  { id: "FL-475-0413:v3:opt-a", title: "Option A", subtitle: "Florida · Agency", src: uri("audio/FL-475-0413/v3/opt-a.mp3") },
  // …
];
await player.setQueue(tracks, 0, resumeMs);
await player.play();
player.on((e) => { if (e.type === "statechange") state.value = e.state; });
```

* `src` for the **native** player: an `https://` URL or the `file://` URI from
  `Filesystem.getUri()`. For the **web** player on native, pass the path through
  `toWebPlayableSrc()` (→ `Capacitor.convertFileSrc`).
* Hands-free mode = `autoAdvance: true` with a queue of `full.mp3` tracks (one
  per item). Interactive mode = queue of part files (`stem`, `opt-a…d`,
  `explanation`) so the UI can highlight the part being read.
* Rate is clamped to 0.75–2.5 everywhere (`clampRate`).

## Lock-screen controls by implementation

| Control | Web (Media Session API) | Native (mediagrid plugin) | TTS fallback |
| --- | --- | --- | --- |
| Play / pause | yes | yes | no (foreground UI only) |
| Next / previous track | yes (`nexttrack`/`previoustrack`) | **no** — plugin exposes skip ±N s only (we set 15 s). See `native.ts` header note 2 for the fork option. | no |
| Seek / scrubber | yes (`seekto` + `setPositionState`) | seek yes; scrubber depends on OS | no |
| Title / subtitle / artwork | yes | yes | no |
| Background playback | **web browsers only** — not reliable inside the iOS/Android WebView | yes (AVAudioSession `.playback` + Media3 `MediaSessionService`) | no |

## Testing

Everything is injectable:

* `new WebNarrationPlayer(opts, () => fakeAudioElement)`
* `new NativeNarrationPlayer(fakePlugin, opts)` — `fakePlugin` implements `MediagridAudioPlayerPlugin`
* `new SpeechNarrationPlayer(opts, fakeSynth, (text) => fakeUtterance)`

Type-check standalone:

```sh
npx -y tsc --noEmit --strict --target ES2022 --moduleResolution bundler --module ESNext --lib ES2022,DOM apps/app/lib/narration/*.ts
```

## Native project configuration

See `docs/AUDIO_SPIKE.md` §4 for the exact `Info.plist`, `AndroidManifest.xml`
and `strings.xml` entries. Without them the native player plays only while the
app is in the foreground.
