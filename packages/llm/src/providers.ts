/**
 * OpenAI-compatible providers, in fallback order. Every value can be overridden from .env:
 *   LLM_PROVIDER_ORDER=groq,cerebras,mistral,deepseek,nvidia
 *   <PROVIDER>_MODEL, <PROVIDER>_MAX_INPUT_TOKENS, <PROVIDER>_RPM
 *   GROQ_API_KEY / CEREBRAS_API_KEY / MISTRAL_API_KEY / DEEPSEEK_API_KEY / NVIDIA_API_KEYS (comma-separated)
 *
 * maxInputTokens is the practical prompt ceiling on the FREE tier (Groq caps tokens per minute per
 * model at ~8–12K, so a 30K-token statute prompt must skip it). rpm is per key.
 */
import { loadEnv } from "./env.js";

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  keys: string[];
  model: string;
  /** Fallback models on the same provider if the primary is unavailable/decommissioned. */
  altModels: string[];
  maxInputTokens: number;
  rpm: number;
  jsonMode: boolean;
  /** Max in-flight requests across all keys of this provider (free tiers often cap concurrency per account). */
  maxConcurrent: number;
}

const DEFAULTS: Record<string, Omit<ProviderConfig, "keys" | "name" | "maxConcurrent"> & { maxConcurrent?: number }> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", altModels: ["qwen/qwen3.8-27b"], maxInputTokens: 7000, rpm: 30, jsonMode: true },
  cerebras: { baseUrl: "https://api.cerebras.ai/v1", model: "gpt-oss-120b", altModels: ["qwen-3.8-27b", "gemma-4-31b"], maxInputTokens: 50000, rpm: 30, jsonMode: true },
  mistral: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-medium-latest", altModels: ["magistral-medium-latest", "mistral-small-latest"], maxInputTokens: 100000, rpm: 60, jsonMode: true },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-v4-pro", altModels: ["deepseek-v4-flash"], maxInputTokens: 100000, rpm: 60, jsonMode: true },
  // deepseek-v4-pro on NVIDIA hangs; kimi-k3 is strong but a slow reasoning model (80–150 s per drafting call).
  // minimax-m3 answers in ~3 s and nemotron-3-super in ~7 s; kimi-k3 stays as the verifier default (see VERIFY_NVIDIA_MODEL).
  nvidia: { baseUrl: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-3-super-120b-a12b", altModels: ["moonshotai/kimi-k3", "minimaxai/minimax-m3", "openai/gpt-oss-20b"], maxInputTokens: 100000, rpm: 40, jsonMode: true, maxConcurrent: 2 },
};

function keysFor(name: string): string[] {
  const upper = name.toUpperCase();
  const multi = process.env[`${upper}_API_KEYS`];
  const single = process.env[`${upper}_API_KEY`];
  const list = [...(multi ? multi.split(",") : []), ...(single ? [single] : [])].map((k) => k.trim()).filter(Boolean);
  return [...new Set(list)];
}

/**
 * `role` selects per-role model overrides from .env, e.g. VERIFY_NVIDIA_MODEL=moonshotai/kimi-k3,
 * so verification can use a slower, stronger model than drafting.
 */
export function loadProviders(role?: string): ProviderConfig[] {
  loadEnv();
  const order = (process.env.LLM_PROVIDER_ORDER ?? "groq,cerebras,mistral,deepseek,nvidia").split(",").map((s) => s.trim()).filter(Boolean);
  const out: ProviderConfig[] = [];
  for (const name of order) {
    const d = DEFAULTS[name];
    if (!d) { console.warn(`[llm] unknown provider in LLM_PROVIDER_ORDER: ${name}`); continue; }
    const keys = keysFor(name);
    if (!keys.length) continue;
    const U = name.toUpperCase();
    out.push({
      name, keys, baseUrl: process.env[`${U}_BASE_URL`] ?? d.baseUrl,
      model: (role && process.env[`${role.toUpperCase()}_${U}_MODEL`]) || process.env[`${U}_MODEL`] || d.model, altModels: d.altModels,
      maxInputTokens: Number(process.env[`${U}_MAX_INPUT_TOKENS`] ?? d.maxInputTokens),
      rpm: Number(process.env[`${U}_RPM`] ?? d.rpm), jsonMode: d.jsonMode,
      maxConcurrent: Number(process.env[`${U}_MAX_CONCURRENT`] ?? d.maxConcurrent ?? 4),
    });
  }
  return out;
}

/** Rough token estimate (chars / 3.6) — conservative for legal English. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}
