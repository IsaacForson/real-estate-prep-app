/**
 * LlmRouter — one `chat()` that tries providers in order, rotates keys, honours per-key RPM,
 * cools down on 429, skips providers whose free-tier input cap is below the prompt, and falls to
 * the next provider on 5xx / network errors. Model-level fallbacks handle decommissioned models.
 */
import { loadProviders, estimateTokens, type ProviderConfig } from "./providers.js";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Ask for a JSON object (response_format json_object where supported). */
  json?: boolean;
  /** Restrict to these providers (names) for this call. */
  providers?: string[];
  signal?: AbortSignal;
}
export interface ChatResult {
  text: string;
  provider: string;
  model: string;
  keyIndex: number;
  usage: { input: number; output: number };
  attempts: number;
  ms: number;
}

export class LlmError extends Error {
  constructor(message: string, public readonly attempts: Array<{ provider: string; model: string; status: number | null; detail: string }>) { super(message); }
}

interface KeyState { cooldownUntil: number; windowStart: number; used: number }

const TERMINAL_STATUS = new Set([400, 401, 403, 404, 413, 422]);

export class LlmRouter {
  private providers: ProviderConfig[];
  private state = new Map<string, KeyState>();
  private rr = new Map<string, number>();
  /** Providers disabled for the life of this router (402 payment required, 401 bad key). */
  private disabled = new Map<string, string>();
  private inFlight = new Map<string, number>();
  /** consecutive all-keys-limited events per provider → exponential backoff (15 s, 30 s, 60 s, … ≤ 5 min) */
  private saturation = new Map<string, { count: number; until: number }>();
  public log: (line: string) => void = () => {};

  constructor(providers?: ProviderConfig[]) {
    this.providers = providers ?? loadProviders();
    if (!this.providers.length) throw new Error("no LLM providers configured — set GROQ_API_KEY / NVIDIA_API_KEYS etc. in .env");
  }

  get available(): string[] { return this.providers.map((p) => p.name); }

  private key(p: ProviderConfig, i: number) { return `${p.name}#${i}`; }
  private st(p: ProviderConfig, i: number): KeyState {
    const k = this.key(p, i);
    let s = this.state.get(k);
    if (!s) { s = { cooldownUntil: 0, windowStart: 0, used: 0 }; this.state.set(k, s); }
    return s;
  }

  /** Pick the next usable key (round-robin, skipping cooldowns and exhausted RPM windows). */
  private pickKey(p: ProviderConfig, now: number): number | null {
    const start = this.rr.get(p.name) ?? 0;
    for (let n = 0; n < p.keys.length; n++) {
      const i = (start + n) % p.keys.length;
      const s = this.st(p, i);
      if (s.cooldownUntil > now) continue;
      if (now - s.windowStart >= 60_000) { s.windowStart = now; s.used = 0; }
      if (s.used >= p.rpm) continue;
      this.rr.set(p.name, (i + 1) % p.keys.length);
      return i;
    }
    return null;
  }

  /** Earliest time any key of this provider frees up (for waiting instead of failing). */
  private nextFree(p: ProviderConfig, now: number): number {
    let best = Infinity;
    for (let i = 0; i < p.keys.length; i++) {
      const s = this.st(p, i);
      const t = Math.max(s.cooldownUntil, s.used >= p.rpm ? s.windowStart + 60_000 : 0);
      best = Math.min(best, t <= now ? now : t);
    }
    return best;
  }

  private async acquire(p: ProviderConfig): Promise<() => void> {
    while ((this.inFlight.get(p.name) ?? 0) >= p.maxConcurrent) await new Promise((r) => setTimeout(r, 250));
    this.inFlight.set(p.name, (this.inFlight.get(p.name) ?? 0) + 1);
    return () => this.inFlight.set(p.name, Math.max(0, (this.inFlight.get(p.name) ?? 1) - 1));
  }
  private saturated(p: ProviderConfig, now: number): boolean { return (this.saturation.get(p.name)?.until ?? 0) > now; }
  private markSaturated(p: ProviderConfig) {
    const s = this.saturation.get(p.name) ?? { count: 0, until: 0 };
    s.count++; s.until = Date.now() + Math.min(300_000, 15_000 * 2 ** (s.count - 1));
    this.saturation.set(p.name, s);
    this.log(`[llm] ${p.name} saturated; backing off ${Math.round((s.until - Date.now()) / 1000)}s`);
  }
  private clearSaturation(p: ProviderConfig) { this.saturation.delete(p.name); }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const started = Date.now();
    const inputTokens = estimateTokens(req.messages.map((m) => m.content).join("\n"));
    const attempts: LlmError["attempts"] = [];
    const candidates = this.providers.filter((p) => (!req.providers || req.providers.includes(p.name)) && !this.disabled.has(p.name));
    if (!candidates.length) throw new LlmError(`no usable providers (disabled: ${[...this.disabled].map(([k, v]) => `${k}: ${v}`).join("; ")})`, attempts);
    const fitting = candidates.filter((p) => inputTokens <= p.maxInputTokens);
    if (!fitting.length) throw new LlmError(`prompt of ~${inputTokens} tokens exceeds every provider's input cap (${candidates.map((p) => `${p.name}:${p.maxInputTokens}`).join(", ")})`, attempts);

    // Several passes: each later pass waits for the earliest key to free up (total wait ≤ ~5 min).
    const maxPasses = Number(process.env.LLM_MAX_PASSES ?? 8);
    for (let pass = 0; pass < maxPasses; pass++) {
      for (const p of fitting) {
        if (this.saturated(p, Date.now())) continue;
        const models = [p.model, ...p.altModels];
        const release = await this.acquire(p);
        try {
        for (const model of models) {
          let keyIdx = this.pickKey(p, Date.now());
          if (keyIdx == null) break; // provider saturated; try next provider
          const s = this.st(p, keyIdx);
          s.used++;
          let r = await this.call(p, keyIdx, model, req);
          attempts.push({ provider: p.name, model, status: r.status, detail: r.detail.slice(0, 200) });
          // Groq validates JSON-mode output server-side and returns 400 when the model rambles; retry once without json mode.
          if (!r.ok && r.status === 400 && req.json && /validate JSON|json_validate_failed|response_format|json_object|json mode/i.test(r.detail)) {
            this.log(`[llm] ${p.name}/${model} json-mode validation failed; retrying without response_format`);
            r = await this.call(p, keyIdx, model, { ...req, json: false });
            attempts.push({ provider: p.name, model, status: r.status, detail: r.detail.slice(0, 200) });
          }
          if (!r.ok && (r.status === 402 || r.status === 401)) {
            this.disabled.set(p.name, `${r.status} ${r.detail.slice(0, 120).replace(/\s+/g, " ")}`);
            this.log(`[llm] ${p.name} disabled for this run: ${r.status}`);
            break;
          }
          if (r.ok) {
            this.clearSaturation(p);
            this.log(`[llm] ${p.name}/${model} key#${keyIdx} ok in ${Date.now() - started}ms (~${inputTokens} in)`);
            return { text: r.text, provider: p.name, model, keyIndex: keyIdx, usage: r.usage, attempts: attempts.length, ms: Date.now() - started };
          }
          if (r.status === 429) {
            // Daily/token-budget limits come back with a long retry-after: disable the provider for this run.
            if ((r.retryAfterMs ?? 0) > 10 * 60_000 || /per day|daily|tokens per day|TPD/i.test(r.detail)) {
              this.disabled.set(p.name, `429 long retry-after (${Math.round((r.retryAfterMs ?? 0) / 60000)} min): ${r.detail.slice(0, 100).replace(/\s+/g, " ")}`);
              this.log(`[llm] ${p.name} disabled for this run: daily limit`);
              break;
            }
            // Concurrency-style 429s (NVIDIA) clear quickly; per-minute limits need the window to roll.
            const wait = r.retryAfterMs ?? (p.keys.length > 1 ? 15_000 : 60_000);
            s.cooldownUntil = Date.now() + wait;
            this.log(`[llm] ${p.name} key#${keyIdx} rate-limited; cooldown ${Math.round(wait / 1000)}s — ${r.detail.slice(0, 140).replace(/\s+/g, " ")}`);
            // try other keys of the same provider first
            let next = this.pickKey(p, Date.now());
            let all429 = true;
            while (next != null) {
              const s2 = this.st(p, next); s2.used++;
              const r2 = await this.call(p, next, model, req);
              attempts.push({ provider: p.name, model, status: r2.status, detail: r2.detail.slice(0, 200) });
              if (r2.ok) return { text: r2.text, provider: p.name, model, keyIndex: next, usage: r2.usage, attempts: attempts.length, ms: Date.now() - started };
              if (r2.status === 429) { this.log(`[llm] ${p.name} key#${next} rate-limited too`); s2.cooldownUntil = Date.now() + (r2.retryAfterMs ?? 15_000); next = this.pickKey(p, Date.now()); continue; }
              all429 = false; break;
            }
            // Every key limited on this model → the cap is per model/account, not per key: clear the key
            // cooldowns and try the provider's next model before leaving for another provider.
            if (all429 && models.indexOf(model) < models.length - 1) {
              for (let i = 0; i < p.keys.length; i++) this.st(p, i).cooldownUntil = 0;
              this.log(`[llm] ${p.name}/${model} limited on all keys; trying ${models[models.indexOf(model) + 1]}`);
              continue;
            }
            if (all429) this.markSaturated(p); // every model on every key limited → account-level cap
            break; // next provider
          }
          if (r.status === 404 || /model|decommission|not found|unsupported/i.test(r.detail) && r.status === 400) continue; // try alt model
          if (r.status != null && TERMINAL_STATUS.has(r.status)) {
            if (/context|too long|maximum context|token/i.test(r.detail)) break; // too big for this provider → next provider
            throw new LlmError(`${p.name}/${model} rejected the request (${r.status}): ${r.detail.slice(0, 300)}`, attempts);
          }
          break; // 5xx / network → next provider
        }
        } finally { release(); }
      }
      // everything saturated or failed: wait for the earliest key to free (max 65 s) and retry once more
      const now = Date.now();
      const soonest = Math.min(...fitting.map((p) => this.nextFree(p, now)));
      if (!isFinite(soonest)) break;
      const satUntil = Math.min(...fitting.map((p) => this.saturation.get(p.name)?.until ?? Infinity));
      const wait = Math.min(120_000, Math.max(10_000, Math.min(soonest, isFinite(satUntil) ? satUntil : Infinity) - now));
      this.log(`[llm] all providers busy/failing; waiting ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
    throw new LlmError(`all providers failed after ${attempts.length} attempts: ` + attempts.map((a) => `${a.provider}/${a.model}:${a.status ?? "net"}`).join(", "), attempts);
  }

  private async call(p: ProviderConfig, keyIdx: number, model: string, req: ChatRequest): Promise<{ ok: boolean; status: number | null; detail: string; text: string; usage: { input: number; output: number }; retryAfterMs?: number }> {
    const body: Record<string, unknown> = {
      model, messages: req.messages, max_tokens: req.maxTokens ?? 4096, temperature: req.temperature ?? 0.4, stream: false,
    };
    if (req.json && p.jsonMode) body.response_format = { type: "json_object" };
    try {
      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${p.keys[keyIdx]}` },
        body: JSON.stringify(body),
        signal: req.signal ?? AbortSignal.timeout(180_000),
      });
      const raw = await res.text();
      if (!res.ok) {
        const ra = res.headers.get("retry-after");
        const retryAfterMs = ra ? (Number.isFinite(Number(ra)) ? Number(ra) * 1000 : Math.max(0, Date.parse(ra) - Date.now())) : undefined;
        return { ok: false, status: res.status, detail: raw, text: "", usage: { input: 0, output: 0 }, retryAfterMs };
      }
      const data = JSON.parse(raw);
      const choice = data.choices?.[0];
      let text: string = choice?.message?.content ?? "";
      if (!text && choice?.message?.reasoning_content) text = choice.message.reasoning_content; // reasoning-only reply: let the JSON extractor try
      if (!text && choice?.finish_reason === "length") return { ok: false, status: 400, detail: "empty content with finish_reason=length (raise max_tokens for reasoning models)", text: "", usage: { input: 0, output: 0 } };
      // Some models wrap JSON in fences or prepend reasoning; strip fences.
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      return { ok: true, status: res.status, detail: "", text, usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 } };
    } catch (e) {
      return { ok: false, status: null, detail: String(e), text: "", usage: { input: 0, output: 0 } };
    }
  }
}
