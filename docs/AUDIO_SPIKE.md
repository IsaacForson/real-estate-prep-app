# Phase 0 audio spike — F6 in Nuxt 4 + Capacitor 8

Date: 2026-09-08. Research + drop-in module; no device build was possible in this environment,
so §5 is the checklist Forson runs on real hardware to close the gate.

Scope (SPEC §4.2 F6): narrate questions, options, explanations, flashcards; speed 0.75×–2.5×;
pause without losing position; background + lock-screen playback with media controls
(play/pause/next/previous, artwork/title); hands-free auto-advance; pre-generated server-side
MP3/AAC per item, cached; on-device TTS only as an offline fallback (SPEC §8).

---

## 0. TL;DR

**GO on Capacitor** — but not with HTML5 `<audio>` in the WebView. Background and lock-screen
playback must go through a native plugin, and one exists that is Capacitor-8 native, MIT, and
built on the exact OS primitives the platforms now require (`AVAudioSession` + `MPNowPlayingInfoCenter`
on iOS; Media3 `MediaSessionService` foreground service on Android):
**`@mediagrid/capacitor-native-audio` v3.0.0**. It has two gaps the validation day must confirm
(no next/previous remote command — shows skip ±15 s instead; iOS rate snapping unless the pitch
algorithm is set), both fixable with a small fork because the plugin is ~1,500 lines. Plan B inside
Capacitor is `capacitor-plugin-playlist` 0.11.4 (queue + next/prev, but iOS 18 minimum and a legacy
ExoMedia Android stack). React Native + `@rntp/player` v5 is the last resort and is now a paid
licence (€99/mo per production app).

---

## 1. Findings

### 1.1 Approach A — HTML5 `<audio>` + Media Session API inside the WebView

| Platform | What actually happens (Sept 2026) |
| --- | --- |
| **iOS WKWebView** | Playback of the *current* element can continue in the background if `UIBackgroundModes` contains `audio` and the AVAudioSession category is `.playback` (Apple: the `audio` key is required "in addition to using the correct category" — [Audio Session Categories](https://developer.apple.com/library/archive/documentation/Audio/Conceptual/AudioSessionProgrammingGuide/AudioSessionCategoriesandModes/AudioSessionCategoriesandModes.html), [Configuring your app for media playback](https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback)). But WebKit's audio pipeline is not a first-class Now Playing client: (1) starting a **new** `<audio>` element while backgrounded/locked fails — the element fires `ended` and `.play()` is a no-op (report on iOS 17.2.1, [Apple forums 713084](https://developer.apple.com/forums/thread/713084)); that kills auto-advance across items, the whole hands-free use case. (2) History of regressions: audio killed after ~15 s in background on iOS 13, "fixed in 14 beta 2, reintroduced" ([capacitor#3446](https://github.com/ionic-team/capacitor/discussions/3446)); Web Audio contexts do not resume after lock ([Apple forums 658375](https://developer.apple.com/forums/thread/658375)). (3) Capacitor does not set an AVAudioSession category for you; you need `@capawesome/capacitor-audio-session` (iOS-only, free) or native code, and "the last write wins" across plugins ([Capawesome docs](https://capawesome.io/docs/sdks/capacitor/audio-session/)). Media Session API does work on iOS ≥ 15 for the lock screen while the element plays. |
| **Android WebView** | The Media Session Web API is **not implemented in Android WebView**, and the WebView is paused when the app is backgrounded, so audio stops ([jofr/capacitor-media-session](https://github.com/jofr/capacitor-media-session): "audio playback using web standards does not work reliably in the background"). The only way to keep it alive is a foreground service of type `mediaPlayback`; the plugin that did that for `<audio>` (`@jofr/capacitor-media-session` 4.0.0) targets Capacitor 6, last release 2024-08-08, GPL-3.0, 24 open issues — not usable for a Capacitor 8 commercial app. Android 14+ requires the FGS type + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permission ([FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types)); **Android 17 "background audio hardening"** silently mutes any audio from an app with no visible activity and no (non-short) FGS, and for apps targeting 17 the FGS must have while-in-use capability — Google's stated way to be "largely exempt" is Media3 `MediaSessionService` ([Android 17 bg-audio](https://developer.android.com/about/versions/17/changes/bg-audio)). A WebView `<audio>` cannot satisfy that on its own. |
| **Web (desktop/mobile browsers)** | Fully works: `playbackRate` 0.75–2.5 with `preservesPitch`, Media Session metadata/actions, background tabs keep playing. WebKit uses the time-domain pitch algorithm for `<audio>` so non-snapped rates are honoured ([WebKit 220341](https://bugs.webkit.org/show_bug.cgi?id=220341)). This is the web product's player and is implemented in `apps/app/lib/narration/player.ts`. |

**Verdict:** A is the right implementation for the web product and the in-app fallback, and the wrong
one for native background playback. Do not spend the validation day trying to make it work in the WebView.

### 1.2 Approach B — native Capacitor plugins

All version/date facts below were read from the npm registry and GitHub API on 2026-09-08.

| Plugin | Latest / date | Cap 8 | Rate | Lock screen / Now Playing | Background | Queue / gapless | Local files | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **[`@mediagrid/capacitor-native-audio`](https://github.com/mediagrid/capacitor-native-audio)** | 3.0.0 · 2026-01-23 · MIT · 65★ · 0 open issues · peer `@capacitor/core >=8` | yes (v3 = "Upgrade to Capacitor 8", Media3 1.9.0; SPM `Package.swift` present) | `setRate({audioId, rate})` → iOS `AVPlayer.rate`, Android `ExoPlayer.setPlaybackSpeed` (pitch preserved). **iOS caveat:** default `audioTimePitchAlgorithm` (`lowQualityZeroLatency`) snaps to {0.5, 0.67, 0.8, 1, 1.25, 1.5, 2}; needs `.timeDomain` for 0.75/2.5 ([Apple forums 4797](https://forums.developer.apple.com/forums/thread/4797)). | iOS `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` play/pause/skipForward/skipBackward (configurable interval; **no next/prev track command**); Android Media3 `MediaSession` notification with title/artist/album/artwork (`changeMetadata`). | iOS: `AVAudioSession(.playback, mode: .spokenAudio)`, interruption notifications handled. Android: `AudioPlayerService extends MediaSessionService`, `foregroundServiceType="mediaPlayback"`, `WAKE_MODE_NETWORK`, `AUDIO_CONTENT_TYPE_SPEECH`. | No queue; one primary source (`useForNotification`) at a time; `changeAudioSource` swaps in place. Not gapless. | Any URL string incl. `file://` (iOS `URL(string:)`, Android `Uri.parse` → Media3). Bare paths rejected. | **Recommended.** Right primitives on both OSes; small codebase; gaps are fixable. Risk: single maintainer, last activity Jan 2026. |
| [`capacitor-plugin-playlist`](https://github.com/phiamo/capacitor-plugin-playlist) | 0.11.4 · 2026-07-28 · MIT · 32★ · 6 open issues · peer `>=8` | yes | `setPlaybackRate()` (0 = pause, 1 = normal) | Full: play/pause/**next/prev**, artwork, title/artist/album | iOS `UIBackgroundModes audio`; Android `MediaService` FGS `mediaPlayback` (manifest merged by the plugin) | **Yes** — `setPlaylistItems/addItem/skipForward/skipBack`, native track advancement | Yes (`file://`, app paths, streams) | **Plan B.** Meets every F6 bullet on paper. Costs: **iOS 18 minimum** (Capacitor 8 baseline is 15), Android uses `com.devbrackets.android:exomedia:5.2.0` (ExoPlayer-era, not Media3 — must be checked against Android 17 hardening), 0.x versioning, position events suppressed while WebView is backgrounded. |
| [`@capgo/capacitor-native-audio`](https://github.com/Cap-go/capacitor-native-audio) | 8.4.25 · **2026-09-07** · MPL-2.0 · 76★ · 1 open issue | yes, very active (weekly releases) | `setRate` clamped **0.25–4.0** natively (docs say 0.1–1.0; code says 0.25–4.0) | `showNotification` → iOS `MPNowPlayingInfoCenter`/`MPRemoteCommandCenter`; Android `MediaSessionCompat` + `MediaStyle` notification with ±15 s | iOS yes. **Android: no foreground service in the plugin** — README says the FGS "is user responsibility"; without it Android 14+/17 will kill/mute background audio. | No queue; `complete`/`currentTime`/`playbackState` events; `preload`/`playOnce` | Yes (`assets/…`, `file://`, `https://`, HLS) | Best-maintained SFX/music engine, but the missing Android FGS is a blocker for F6 unless you write the service yourself. Keep as a fallback engine for UI sounds. |
| [`@capacitor-community/native-audio`](https://github.com/capacitor-community/native-audio) | 8.0.0 · 2025-12-30 · MIT · 154★ · 63 open issues | yes | none | none | none documented | no | bundled assets | Sound-effects plugin. Not a candidate. |
| [`@capawesome-team/capacitor-audio-player`](https://capawesome.io/docs/sdks/capacitor/audio-player/) | private registry (Capawesome Insiders sponsorship required) · Cap 8 | yes | `setRate` with pitch preservation | Via metadata + `@capawesome/capacitor-media-session`; `AudioPlayerService` FGS on Android | yes | **Yes** — `addTracks/skipToNextTrack/skipToPreviousTrack/setRepeatMode` | `uri` from Filesystem (Android/iOS) | Feature-complete and professionally maintained, but paid/private and not on the public registry (`npm view` returns nothing). Worth pricing if the mediagrid gaps bite. |
| [`@jofr/capacitor-media-session`](https://github.com/jofr/capacitor-media-session) | 4.0.0 · 2024-08-08 · GPL-3.0 · peer Cap 6 | **no** | n/a (wraps `<audio>`) | Media Session API polyfill for Android WebView | Android FGS for the WebView | via `<audio>` | via `<audio>` | Unmaintained for Cap 7/8 and GPL. Not a candidate. |

### 1.3 Approach C — React Native + react-native-track-player

| Package | Status |
| --- | --- |
| [`react-native-track-player`](https://www.npmjs.com/package/react-native-track-player) v4 | 4.1.2 · 2025-08-12 · Apache-2.0. Feature-complete (queue, `setRate`, lock screen, background, caching) but on the old architecture; no releases in 13 months. |
| [`@rntp/player`](https://www.rntp.dev/) v5 | 5.9.2 · 2026-08-26 · **commercial licence** — free for personal/educational only; RNTP Pro €99/month (€999/yr) per production app, Studio €249/month ([pricing](https://www.rntp.dev/pricing)). New Architecture, Media3, CarPlay/Android Auto. |

Switching stacks would cost the free web product (SPEC §8: "web is where your SEO and margin live"),
Forson's Vue leverage, and now a licence fee. It is only justified if both Capacitor plugins fail the
device checklist.

### 1.4 Platform facts that constrain every option

* **Capacitor 8** (`@capacitor/core` 8.5.1, 2026-08-31): Node 22+, Xcode 26+, iOS deployment target 15.0 per the [official update guide](https://capacitorjs.com/docs/updating/8-0) (Capawesome's guide says 16.0 — check what `npx cap add ios` writes), Android `minSdk 24 / compileSdk 36 / targetSdk 36`, AGP 8.13, Kotlin 2.2.20, **SPM by default** for new iOS projects (`--packagemanager CocoaPods` to opt out).
* **iOS:** `UIBackgroundModes: [audio]` + `AVAudioSession` category `.playback` (mode `.spokenAudio` is ideal for narration). The system suspends the app's WebContent process shortly after backgrounding unless audio is genuinely playing through an AVAudioSession the app owns — a native `AVPlayer` satisfies that; a WebKit element only sometimes does.
* **Android 14+ (API 34):** every FGS needs a declared type; media needs `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and `android:foregroundServiceType="mediaPlayback"`; the type must also be declared in Play Console → Policy → App content ([FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types)). Android 15+: may not start a media FGS from `BOOT_COMPLETED`. A Media3 `MediaSessionService` auto-exits foreground after 10 minutes paused ([Media3 background playback](https://developer.android.com/media/media3/session/background-playback)).
* **Android 17:** background audio hardening — see §1.1. Media3 `MediaSessionService` is the sanctioned path, which is what mediagrid uses. Test with `adb shell cmd audio set-enable-hardening throw`.

---

## 2. Recommendation

**GO — Capacitor stays.** Ship F6 on `@mediagrid/capacitor-native-audio` for iOS/Android and the
HTML5 + Media Session web player for the browser, both behind the `NarrationPlayer` interface in
`apps/app/lib/narration/`. Rationale:

1. It is the only public, MIT, Capacitor-8 plugin whose Android side is a Media3 `MediaSessionService`
   (Android 14 FGS typing and Android 17 hardening solved by construction) and whose iOS side owns an
   `AVAudioSession(.playback, .spokenAudio)` with Now Playing + remote commands and interruption handling.
2. Its gaps are small and local: (a) add `playerItem.audioTimePitchAlgorithm = .timeDomain` in
   `ios/Sources/AudioPlayerPlugin/AudioSource.swift#createPlayerItem` so 0.75×/2.5× are honoured;
   (b) optionally add `nextTrackCommand`/`previousTrackCommand` (iOS) and
   `COMMAND_SEEK_TO_NEXT/PREVIOUS_MEDIA_ITEM` (Android) surfaced as a `status` value so the JS queue
   can advance. Upstream PRs first; vendor as `patches/` (pnpm `patchedDependencies`) if unmerged.
3. Queue, auto-advance, position persistence and rate clamping live in TypeScript, so the plugin can
   be swapped for `capacitor-plugin-playlist` (Plan B) or the Capawesome player without touching the UI.

**NO-GO triggers** (switch to Plan B, then to RN only if B also fails): checklist items V1, V4 or V6
fail on either platform after the two patches above.

Position on gapless: not needed. Items are read as stem → options → explanation with natural pauses;
a 100–300 ms swap between part files is inaudible in practice. Hands-free mode plays the stitched
`full.mp3` per item, so there is no swap inside an item at all.

---

## 3. Exact native configuration

### 3.1 Install

```sh
pnpm --filter @rep/app add @mediagrid/capacitor-native-audio@^3.0.0 @capacitor/filesystem@^8
pnpm --filter @rep/app exec cap sync
```

### 3.2 iOS — `apps/app/ios/App/App/Info.plist`

```xml
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

Xcode: target → Signing & Capabilities → Background Modes → "Audio, AirPlay, and Picture in Picture"
(this writes the same key). No microphone/speech keys are needed — the TTS fallback uses
`SpeechSynthesis`, which requires no entitlement.

The plugin sets `AVAudioSession.setCategory(.playback, mode: .spokenAudio)` at load and activates the
session on `play()`. Do **not** also install `@capawesome/capacitor-audio-session` — two writers to the
single app-wide session is exactly the "last write wins" trap.

SPM: Capacitor 8 generates `ios/App/CapApp-SPM/Package.swift`; `cap sync` adds the plugin's
`Package.swift`. If the project was created with CocoaPods, `cap sync` updates the Podfile instead;
nothing else to add. Deployment target must be ≥ 15.0 (Capacitor 8 baseline).

### 3.3 Android — `apps/app/android/app/src/main/AndroidManifest.xml`

```xml
<manifest …>
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />

  <application …>
    <service
      android:name="us.mediagrid.capacitorjs.plugins.nativeaudio.AudioPlayerService"
      android:description="@string/audio_player_service_description"
      android:foregroundServiceType="mediaPlayback"
      android:exported="true">
      <intent-filter>
        <action android:name="androidx.media3.session.MediaSessionService" />
      </intent-filter>
    </service>
  </application>
</manifest>
```

`apps/app/android/app/src/main/res/values/strings.xml`:

```xml
<string name="audio_player_service_description">Plays exam narration in the background.</string>
```

`apps/app/android/variables.gradle` (Capacitor 8 defaults — verify after `cap add android`):

```groovy
minSdkVersion = 24
compileSdkVersion = 36
targetSdkVersion = 36
```

Media notifications from a foreground service display without the `POST_NOTIFICATIONS` runtime
permission on Android 13+, but request it anyway during onboarding so the user can see the
"downloading audio" progress notification later. Play Console: declare the `mediaPlayback` FGS type
under Policy → App content before the first production upload.

### 3.4 Capacitor config

`apps/app/capacitor.config.ts` already sets `server.androidScheme: "https"`; keep it — `convertFileSrc`
then yields `https://localhost/_capacitor_file_/…` for the web player on Android. No plugin-specific config.

---

## 4. Risks

| # | Risk | Likelihood | Mitigation |
| --- | --- | --- | --- |
| R1 | iOS rate snapping (0.75 → 0.8, 2.5 → 2.0) until `audioTimePitchAlgorithm` is set | Certain (read in source) | One-line patch; verify with V3. |
| R2 | No lock-screen next/previous with mediagrid; shows ±15 s instead | Certain | Accept for launch (items are 30–90 s) or the fork in §2.2(b). Plan B has it natively. |
| R3 | mediagrid maintainer inactivity (last push 2026-01-23) | Medium | MIT, ~1,500 LOC, zero open issues. Budget one day to fork; pnpm `patchedDependencies` in the meantime. |
| R4 | Android 17 hardening mutes audio when the FGS was not started from a visible activity or exits after 10 min paused | Medium | Always start playback from a UI tap (never from a timer). V7 covers pause-15-min-resume. |
| R5 | `file://` sources: iOS `URL(string:)` needs percent-encoded paths; Android needs `content://`/`file://` readable by the app process | Low | Store assets under `Directory.Data`, get URIs from `Filesystem.getUri()`, never build paths by string concat. V6. |
| R6 | Interruption recovery (phone call, Siri, other app) — plugin pauses on interruption; resume policy is ours | Medium | `onPlaybackStatusChange` mirrors state; the UI decides whether to auto-resume (`shouldResume` option on iOS is honoured by AVAudioSession notifications). V5. |
| R7 | Capacitor 8 / Xcode 26 / SPM toolchain churn | Medium | Pin `@capacitor/*` 8.5.x, commit `Package.resolved`, CI builds both platforms weekly. |
| R8 | Generative TTS voices drift between model updates (AWS documents this) → a re-rendered item sounds different from its neighbours | Medium | Pin voice + engine per `audio_version`; re-render whole banks, never single items, when changing voice. |
| R9 | Storage: 22k items × ~360 KB (parts) ≈ 8 GB on CDN; a full state download (~1,300 items) ≈ 470 MB at 48 kbps | Certain | Cache on demand + prefetch next N items; "Download this bank's audio" as an explicit opt-in; 32 kbps mono is acceptable for speech if size bites. |

---

## 5. One-day device validation checklist

Hardware: one iPhone on the current iOS (26) and one Android phone on 14+ (ideally 16/17 beta with
`adb shell cmd audio set-enable-hardening throw`). Build a throwaway page in the app shell that mounts
`createNarrationPlayer()` with 10 queued MP3s (≈ 40 s each, mixed `https://` and cached `file://`).
Screenshot every pass/fail. Total ≈ 6 h.

| # | Test | Steps | Pass criteria |
| --- | --- | --- | --- |
| **V1** | 30-min background, screen locked | Queue 40 tracks (≈ 30 min), play, lock the phone immediately. Leave it. | Audio never stops; auto-advance across all 40 tracks with the screen off; lock-screen shows title/subtitle/artwork updating per track. Battery drop < 5 %. |
| **V2** | Lock-screen controls | While locked: pause, play, skip-forward, skip-back (mediagrid) / next, previous (Plan B). Also from AirPods/Bluetooth headset buttons and CarPlay/Android Auto if available. | Every control acts within 500 ms; the app's UI state matches when unlocked (`statechange` events fired). |
| **V3** | Speed change while playing | Play at 1.0; set 0.75, 1.25, 1.5, 2.0, 2.5 in turn without pausing; then 2.5 → 0.75 directly. Time a 30 s track at 2.5× with a stopwatch. | Rate changes apply instantly with pitch preserved; 30 s track finishes in 12 ± 1 s at 2.5× and 40 ± 1 s at 0.75×. **On iOS, if 2.5× measures ~15 s the pitch-algorithm patch (R1) is missing.** No audible artefacts at 2.5×. |
| **V4** | Pause / resume position | Play to ~0:20, pause; wait 2 min; resume. Then pause, background the app for 15 min, resume from the lock screen. Then force-quit the app, reopen, tap "resume". | Resumes within 0.5 s of the paused position each time; after force-quit the persisted `NarrationPosition` restores the same track and position (F8). |
| **V5** | Phone-call interruption | While playing (locked), receive a call; decline it. Then receive and accept a 30 s call, hang up. Also trigger Siri/Assistant mid-playback. | Playback pauses on ring; after decline it resumes automatically (iOS `shouldResume`) or is one tap away with position intact; after an accepted call, same. State machine ends in `paused` or `playing`, never `idle`. |
| **V6** | Offline playback of cached files | Download 10 items' assets with `@capacitor/filesystem` to `Directory.Data`; enable airplane mode; kill and reopen the app; play the queue locked. | All 10 `file://` tracks play in the background; durations and seek work; no network error events. Repeat with the web player + `convertFileSrc` in the foreground on both OSes. |
| **V7** | Android FGS lifecycle | Android only: start playback, background, check `adb shell dumpsys activity services | grep AudioPlayerService` shows a foreground service with type `mediaPlayback`; pause for 11 min; resume from the notification. With hardening `throw` enabled, repeat V1 for 5 min. | Service is foreground while playing; notification persists while paused; resume after 11 min works (service may have restarted — that is fine); no `AudioHardening` failures in logcat. |
| **V8** | Auto-advance edge cases | Set `autoAdvance=false` — track ends → `ended`, lock screen shows paused. Set true, last track ends → `queueended` event, notification clears or shows stopped. | Events observed; no silent hang; `previous()` at track 0 restarts the track. |
| **V9** | TTS fallback | Foreground only. Queue an item with `text` but no `src`; play at 1.0 and 2.0; pause mid-sentence; resume; background the app. | Speaks with an on-device voice; resume restarts the interrupted sentence (never skips it); rate audibly changes; **Android WebView reports `speechSynthesis` unavailable → UI shows "audio not generated yet"** rather than crashing. |

Record results in `docs/DECISIONS.md` as "2026-09-xx — F6 audio spike: PASS/FAIL, plugin, patches".

---

## 6. Server-side TTS asset pipeline

### 6.1 Volume

22,000 items × (stem + 4 options + explanation ≈ 900 chars) ≈ **20 M characters** for a full render.
Glossary (F16) and flashcards add ≈ 10 %. Incremental re-renders after content edits are a rounding
error (an item's text hash changes → re-render that item only).

### 6.2 Providers (US-English neural voices, SSML/speed control, per-character pricing) — prices verified 2026-09-08

| Provider / tier | $/1 M chars | 20 M chars | SSML rate control | Notes |
| --- | --- | --- | --- | --- |
| **Amazon Polly Generative** (en-US Danielle, Joanna, Matthew, Ruth, Salli, Stephen, Tiffany) | $30 | **$600** | `<prosody rate="20%–200%">`, `<break>`, `<say-as>`, `<sub>`, `<phoneme>` (partial), `<mark>` partial; no `<emphasis>`/pitch ([tags](https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html), [generative voices](https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html)) | Most natural of the per-character tier; 24 kHz MP3 output; voices may drift with model updates (R8). Free tier 100k chars/mo first year. [Pricing](https://aws.amazon.com/polly/pricing/). |
| Amazon Polly Neural | $16 | $320 | same as above | Solid, stable, slightly flatter. Fallback if generative sounds "too chatty" for statute text. |
| Google Cloud Neural2 | $16 | $320 | full SSML incl. `<prosody rate>` ([SSML](https://docs.cloud.google.com/text-to-speech/docs/ssml)) | Good; 1 M chars/mo free forever. [Pricing](https://cloud.google.com/text-to-speech/pricing). |
| Google Chirp 3: HD | $30 | $600 | **No SSML**; `speaking_rate` 0.25–2.0 as a request parameter only ([Chirp 3 HD](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd)) | Very natural, but no `<say-as>`/`<break>` control for citations → more pronunciation cleanup in text. |
| Google Studio | $160 | $3,200 | full SSML | Too expensive for the whole bank; consider for the ~200 marketing/onboarding lines only. |
| Azure AI Speech Neural / Neural HD | $16 / $22 (commitment tiers to $7.50) | $320 / $440 | full SSML incl. `mstts:express-as` styles | Strong voices (Ava, Andrew); commitment tier only pays off above ~80 M chars/mo. |
| OpenAI `tts-1` / `tts-1-hd` | $15 / $30 | $300 / $600 | no SSML; `speed` 0.25–4.0 parameter | Natural, but no phonetic/say-as control and no long-term voice pinning guarantees. [Pricing](https://developers.openai.com/api/docs/pricing). |
| OpenAI `gpt-4o-mini-tts` | token-priced ≈ $0.015/min → ≈ $330 | ≈ $330 | prompt-steerable, no SSML | Style via prompt ("read like a calm exam tutor"); pronunciation of `§ 475.25(1)(b)` must be spelled out in text. |
| ElevenLabs Flash v2.5 / v3 | $50 / $100 | $1,000 / $2,000 | no SSML (`<break>` only), speed setting | Best voices, 3–6× the cost; not justified for 20 M chars of test items. [API pricing](https://elevenlabs.io/pricing/api). |

**Choice:** Amazon Polly **Generative, `Matthew` (stem/explanation) and `Ruth` (options)** — two voices
make "the question" and "the choices" audibly distinct, at ≈ $600 for the full bank, with real SSML
(`<say-as interpret-as="characters">` for section symbols, `<break time="400ms"/>` between options,
`<prosody rate="95%">` for numeric stems). Render once at 1.0×; playback speed is a client concern
(never bake 1.5× files). Keep Polly Neural as the documented fallback voice family (same SSML, half the price).

### 6.3 Output format

* Request `OutputFormat=mp3`, `SampleRate=24000` (Polly's max for neural/generative).
* Post-process with ffmpeg: `-ac 1 -c:a libmp3lame -b:a 48k -ar 24000 -af loudnorm=I=-16:LRA=7:TP=-1.5`
  → **MP3 mono 48 kbps, 24 kHz, loudness-normalised** (≈ 6 KB/s → a 60 s item ≈ 360 KB).
  48 kbps is the floor where speech stays crisp at 2.5×; 64 kbps if listening tests prefer it.
  AAC-LC in `.m4a` would be ~20 % smaller at equal quality, but MP3 decodes everywhere incl. old
  Android WebViews and the web player; revisit if size becomes the constraint (R9).
* Leading/trailing silence trimmed to 150 ms so queue swaps feel tight.

### 6.4 Asset naming

```
audio/<item_id>/v<version>/stem.mp3
audio/<item_id>/v<version>/opt-a.mp3 … opt-d.mp3
audio/<item_id>/v<version>/answer.mp3          # "The correct answer is B."
audio/<item_id>/v<version>/explanation.mp3
audio/<item_id>/v<version>/full.mp3            # ffmpeg concat of the parts above, no extra TTS spend
audio/<item_id>/v<version>/manifest.json       # { textHash, voice, engine, parts: { stem: { ms, bytes }, … }, renderedAt }
audio/glossary/<term_slug>/v<version>/term.mp3, definition.mp3
```

`<version>` is the item's `version` field (SPEC §8 record) — it already bumps on every content
change, so the client cache key is simply the path. Files are immutable; CDN `Cache-Control:
public, max-age=31536000, immutable`. `full.mp3` exists so hands-free mode plays one track per item
(one lock-screen entry, no intra-item swaps); interactive mode plays parts so the UI can highlight the
option being read and re-read a single option on tap. `manifest.json` durations feed
`NarrationTrack.durationMs` so scrubbers render before metadata loads.

### 6.5 Hook into `packages/pipeline` publish (description only)

Today `pipeline publish <bank>` (`packages/pipeline/src/qa.ts#publish`) flips `qa_approved → published`
and rewrites the YAML. Add an `audio-render <bank>` step that runs **after** publish (or `--with-audio`
on publish) so audio is only ever spent on items that survived human QA:

1. **Select**: every `published` item in the bank whose narration text hash
   (`sha256(normalise(stem) + options[0..3] + keyText + explanation)`) differs from
   `audio/<id>/v<version>/manifest.json.textHash` on the asset bucket, or whose manifest is missing.
2. **Prepare SSML** per part: expand `§` → "section", `(1)(b)` → "subsection one, b", spell statute
   numbers with `<say-as interpret-as="digits">`, add `<break>` after "A.", "B." …, strip markdown.
   A `packages/content-lint` rule already rejects malformed citations; this step reuses its parser.
3. **Synthesize** with Polly `SynthesizeSpeech` (or `StartSpeechSynthesisTask` for batches > 3,000
   chars), 6 requests per item, concurrency 8; retry on throttling; record `voice`, `engine`, `LanguageCode`.
4. **Post-process**: ffmpeg normalise + trim → parts; `concat` demuxer → `full.mp3`; `ffprobe` →
   durations; write `manifest.json`.
5. **Upload** to the asset bucket (Supabase Storage or R2 behind the CDN) under the immutable path;
   the item YAML is **not** modified (no churn in `content/`); `pipeline status` gains an "audio"
   column computed from manifests present vs published items.
6. **Client manifest**: `apps/app/scripts/build-content-manifest.ts` (already scaffolded) reads the
   bucket listing and emits `{ itemId, version, parts: { stem: { ms } … } }` so the app can build
   `NarrationTrack[]` offline and decide what to prefetch.
7. **Re-render policy**: voice/engine changes bump a global `AUDIO_ENGINE_VERSION` mixed into
   `textHash`, forcing a whole-bank re-render (R8). Retired items' audio is left in place (immutable,
   cheap) and simply unreferenced.

Cost control: dry-run mode prints characters and $ per bank before spending; a hard cap of 2 M
characters per run unless `--yes`.

---

## 7. Sources

* Capacitor 8: [Announcing Capacitor 8](https://ionic.io/blog/announcing-capacitor-8) · [Updating to 8.0](https://capacitorjs.com/docs/updating/8-0) · [Capawesome update guide](https://capawesome.io/blog/updating-to-capacitor-8/)
* WebView background audio: [capacitor#3446](https://github.com/ionic-team/capacitor/discussions/3446) · [Apple forums 713084](https://developer.apple.com/forums/thread/713084) · [Apple forums 658375](https://developer.apple.com/forums/thread/658375) · [Ionic forum thread](https://forum.ionicframework.com/t/audio-in-the-background-for-ionic-capacitor-app/234073) · [WebKit 220341 (time-domain pitch)](https://bugs.webkit.org/show_bug.cgi?id=220341)
* Apple: [UIBackgroundModes](https://developer.apple.com/documentation/bundleresources/information-property-list/uibackgroundmodes) · [Audio session categories](https://developer.apple.com/library/archive/documentation/Audio/Conceptual/AudioSessionProgrammingGuide/AudioSessionCategoriesandModes/AudioSessionCategoriesandModes.html) · [Configuring your app for media playback](https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback) · [AVAudioTimePitchAlgorithm rate snapping](https://forums.developer.apple.com/forums/thread/4797)
* Android: [FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types) · [Android 14 FGS types required](https://developer.android.com/about/versions/14/changes/fgs-types-required) · [Android 15 FGS changes](https://developer.android.com/about/versions/15/changes/foreground-service-types) · [Android 17 background audio hardening](https://developer.android.com/about/versions/17/changes/bg-audio) · [Media3 MediaSessionService](https://developer.android.com/media/media3/session/background-playback)
* Plugins: [mediagrid/capacitor-native-audio](https://github.com/mediagrid/capacitor-native-audio) · [phiamo/capacitor-plugin-playlist](https://github.com/phiamo/capacitor-plugin-playlist) · [Cap-go/capacitor-native-audio](https://github.com/Cap-go/capacitor-native-audio) · [capacitor-community/native-audio](https://github.com/capacitor-community/native-audio) · [Capawesome Audio Player](https://capawesome.io/docs/sdks/capacitor/audio-player/) · [Capawesome Media Session](https://capawesome.io/docs/sdks/capacitor/media-session/) · [Capawesome Audio Session](https://capawesome.io/docs/sdks/capacitor/audio-session/) · [jofr/capacitor-media-session](https://github.com/jofr/capacitor-media-session) · [capacitor-community/text-to-speech](https://github.com/capacitor-community/text-to-speech)
* React Native: [react-native-track-player](https://github.com/doublesymmetry/react-native-track-player) · [rntp.dev](https://www.rntp.dev/) · [rntp pricing](https://www.rntp.dev/pricing)
* TTS pricing: [Polly pricing](https://aws.amazon.com/polly/pricing/) · [Polly SSML tags](https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html) · [Polly prosody](https://docs.aws.amazon.com/polly/latest/dg/prosody-tag.html) · [Google TTS pricing](https://cloud.google.com/text-to-speech/pricing) (summarised by [TextToLab, Jun 2026](https://texttolab.com/blog/google-cloud-tts-pricing)) · [Google SSML](https://docs.cloud.google.com/text-to-speech/docs/ssml) · [Chirp 3 HD](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd) · [Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/) (summarised by [TextToLab, Sep 2026](https://texttolab.com/blog/azure-text-to-speech-pricing)) · [OpenAI pricing](https://developers.openai.com/api/docs/pricing) · [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
