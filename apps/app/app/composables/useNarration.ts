/**
 * F6 — narration. Builds one track per spoken part of a question and drives the narration module.
 * Until pre-generated assets ship (docs/AUDIO_SPIKE.md §TTS pipeline), tracks carry `text` and play
 * through the on-device speech fallback; when an item has audio assets the same tracks get `src`
 * and go through createNarrationPlayer (native plugin on device, HTML5 audio on web).
 */
import type { Item } from "@rep/schema";
import { OPTION_LETTERS } from "@rep/schema";
import { createNarrationPlayer, createTtsFallbackPlayer, isSpeechSynthesisAvailable, clampRate, type NarrationPlayer, type NarrationTrack, type NarrationState } from "~~/lib/narration";

let player: NarrationPlayer | null = null;
let mode: "assets" | "tts" | "none" = "none";

export function useNarration() {
  const settings = useSettings();
  const state = ref<NarrationState>("idle");
  const trackTitle = ref<string>("");
  const available = ref(false);

  function ensure(): NarrationPlayer | null {
    if (!import.meta.client) return null;
    if (player) return player;
    if (!isSpeechSynthesisAvailable()) { mode = "none"; return null; }
    const p = createTtsFallbackPlayer({ persistPosition: () => {} });
    if (!p) { mode = "none"; return null; }
    mode = "tts";
    p.on((e) => {
      if (e.type === "statechange") state.value = e.state;
      if (e.type === "trackchange") trackTitle.value = e.track?.title ?? "";
    });
    void p.setRate(clampRate(settings.narrationRate));
    p.setAutoAdvance(true);
    player = p;
    return p;
  }

  /** Tracks for an item: stem, each option, and (if revealed) the verdict + explanation + citation. */
  function tracksFor(item: Item, opts: { reveal: boolean; label: string; audioBase?: string }): NarrationTrack[] {
    const subtitle = `${item.bank.replace("national_", "").replace("state_", "")} · ${item.blueprint_node}`;
    const base = opts.audioBase ? `${opts.audioBase}/${item.id}/v${item.version}` : null;
    const t = (part: string, title: string, text: string): NarrationTrack => ({ id: `${item.id}:v${item.version}:${part}`, title, subtitle, src: base ? `${base}/${part}.mp3` : "", text });
    const out = [t("stem", opts.label, item.stem.replace(/\*\*/g, ""))];
    item.options.forEach((o, i) => out.push(t(`opt-${OPTION_LETTERS[i]!.toLowerCase()}`, `Option ${OPTION_LETTERS[i]}`, `${OPTION_LETTERS[i]}. ${o}`)));
    if (opts.reveal) {
      out.push(t("answer", "Answer", `The answer is ${item.key}. ${item.options[OPTION_LETTERS.indexOf(item.key)]}.`));
      out.push(t("explanation", "Explanation", item.explanation + (item.math ? ` Worked solution: ${item.math.worked_solution}` : "")));
      out.push(t("citation", "Citation", `${item.citation.source}. Quote: ${item.citation.quoted_text}`));
    }
    return out;
  }

  async function speak(item: Item, opts: { reveal: boolean; label: string }) {
    const p = ensure(); available.value = !!p;
    if (!p) return;
    await p.setQueue(tracksFor(item, opts));
    await p.play();
  }
  async function toggle() { await ensure()?.toggle(); }
  async function stop() { const p = player; if (p) { await p.pause(); } }
  async function setRate(rate: number) { settings.set("narrationRate", clampRate(rate)); await ensure()?.setRate(clampRate(rate)); }
  async function next() { await ensure()?.next(); }
  async function previous() { await ensure()?.previous(); }

  onMounted(() => { available.value = isSpeechSynthesisAvailable(); });
  return { state, trackTitle, available, mode: () => mode, speak, toggle, stop, setRate, next, previous, tracksFor };
}

export { createNarrationPlayer };
