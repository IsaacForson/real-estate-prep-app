/**
 * F6 — pre-generated narration assets. `pipeline audio-render <bank> [--voice troy] [--status qa_approved]`
 * renders one MP3 per spoken part of each item via an OpenAI-compatible /audio/speech endpoint
 * (Groq's free `canopylabs/orpheus-v1-english` by default; requires one-time terms acceptance in
 * the Groq console). Layout follows docs/AUDIO_SPIKE.md:
 *   content/audio/<item_id>/v<version>/{stem,opt-a,opt-b,opt-c,opt-d,answer,explanation}.mp3 + manifest.json
 * Existing files are skipped, so re-runs only render new items/versions.
 */
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Item, OPTION_LETTERS } from "@rep/schema";
import { loadItems } from "@rep/content-lint";
import { loadEnv } from "@rep/llm";
import { CONFIG } from "./config.js";
import { writeJson } from "./fsx.js";

export const AUDIO = {
  baseUrl: () => process.env.TTS_BASE_URL ?? "https://api.groq.com/openai/v1",
  apiKey: () => process.env.TTS_API_KEY ?? process.env.GROQ_API_KEY ?? "",
  model: () => process.env.TTS_MODEL ?? "canopylabs/orpheus-v1-english",
  voice: () => process.env.TTS_VOICE ?? "troy",
  /** Groq's Orpheus endpoint only emits WAV; we transcode to MP3 (mono, 48 kbps) with ffmpeg when present. */
  format: () => process.env.TTS_FORMAT ?? "wav",
  rpm: Number(process.env.TTS_RPM ?? 10),
};

export function spokenParts(item: Item): Array<{ part: string; text: string }> {
  const clean = (s: string) => s.replace(/\*\*/g, "").replace(/§/g, "section ");
  const parts = [{ part: "stem", text: clean(item.stem) }];
  item.options.forEach((o, i) => parts.push({ part: `opt-${OPTION_LETTERS[i]!.toLowerCase()}`, text: `${OPTION_LETTERS[i]}. ${clean(o)}` }));
  parts.push({ part: "answer", text: `The answer is ${item.key}. ${clean(item.options[OPTION_LETTERS.indexOf(item.key)]!)}.` });
  parts.push({ part: "explanation", text: clean(item.explanation) + (item.math ? ` Worked solution: ${clean(item.math.worked_solution)}` : "") });
  return parts;
}

async function tts(text: string): Promise<Uint8Array> {
  const res = await fetch(`${AUDIO.baseUrl()}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${AUDIO.apiKey()}`, "content-type": "application/json" },
    body: JSON.stringify({ model: AUDIO.model(), voice: AUDIO.voice(), input: text, response_format: AUDIO.format() }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) { const ra = Number(res.headers.get("retry-after") ?? 30); await new Promise((r) => setTimeout(r, ra * 1000)); return tts(text); }
    throw new Error(`TTS ${res.status}: ${body.slice(0, 300)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function renderAudio(bank: string, opts: { status?: Item["status"][]; limit?: number; log?: (s: string) => void } = {}): Promise<{ items: number; files: number; skipped: number; failed: number }> {
  loadEnv();
  const log = opts.log ?? ((s: string) => console.log(s));
  if (!AUDIO.apiKey()) throw new Error("no TTS key: set GROQ_API_KEY or TTS_API_KEY in .env");
  const statuses = new Set(opts.status ?? ["qa_approved", "published"]);
  let items = loadItems(CONFIG.contentDir).items.map((x) => x.value).filter((i) => i.bank === bank && statuses.has(i.status));
  if (opts.limit) items = items.slice(0, opts.limit);
  log(`audio-render ${bank}: ${items.length} items via ${AUDIO.model()} voice ${AUDIO.voice()}`);
  let files = 0, skipped = 0, failed = 0;
  const minGap = Math.ceil(60_000 / AUDIO.rpm);
  let last = 0;
  for (const it of items) {
    const dir = join(CONFIG.contentDir, "audio", it.id, `v${it.version}`);
    mkdirSync(dir, { recursive: true });
    const manifest: Record<string, { file: string; bytes: number; text_sha: string }> = {};
    for (const p of spokenParts(it)) {
      const file = join(dir, `${p.part}.mp3`);
      if (existsSync(file) && statSync(file).size > 0) { skipped++; manifest[p.part] = { file: `${p.part}.mp3`, bytes: statSync(file).size, text_sha: sha(p.text) }; continue; }
      const wait = last + minGap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      try {
        const bytes = await tts(p.text);
        if (AUDIO.format() === "mp3" || !hasFfmpeg()) writeFileSync(file, bytes);
        else { const tmp = file.replace(/\.mp3$/, `.${AUDIO.format()}`); writeFileSync(tmp, bytes); execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-ar", "24000", "-b:a", "48k", "-af", "loudnorm", file]); unlinkSync(tmp); }
        manifest[p.part] = { file: `${p.part}.mp3`, bytes: bytes.length, text_sha: sha(p.text) };
        files++;
      } catch (e) { failed++; log(`  ${it.id}/${p.part}: ${String(e).slice(0, 160)}`); if (/terms acceptance|model_terms_required/.test(String(e))) throw e; }
    }
    writeJson(join(dir, "manifest.json"), { item: it.id, version: it.version, model: AUDIO.model(), voice: AUDIO.voice(), parts: manifest, rendered_on: new Date().toISOString().slice(0, 10) });
    log(`  ${it.id}: ${Object.keys(manifest).length} parts`);
  }
  return { items: items.length, files, skipped, failed };
}

let ffmpegChecked: boolean | null = null;
function hasFfmpeg(): boolean {
  if (ffmpegChecked != null) return ffmpegChecked;
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); ffmpegChecked = true; } catch { ffmpegChecked = false; }
  return ffmpegChecked;
}

function sha(s: string): string {
  // tiny non-crypto hash for change detection (FNV-1a)
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
