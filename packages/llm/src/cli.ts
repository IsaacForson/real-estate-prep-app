#!/usr/bin/env tsx
/** `llm probe` — one tiny JSON request per provider, reporting latency and the model that answered. */
import { LlmRouter, loadProviders } from "./index.js";
const cmd = process.argv.slice(2).filter((a) => a !== "--")[0];
if (cmd !== "probe") { console.log("usage: llm probe"); process.exit(1); }
const providers = loadProviders();
console.log(`providers: ${providers.map((p) => `${p.name}(${p.keys.length} key${p.keys.length > 1 ? "s" : ""}, ${p.model}, ≤${p.maxInputTokens} tok)`).join("  ")}`);
for (const p of providers) {
  const r = new LlmRouter([p]);
  const t = Date.now();
  try {
    const res = await r.chat({ messages: [{ role: "user", content: 'Reply with the JSON object {"ok": true, "model": "<your model name>"} and nothing else.' }], json: true, maxTokens: 60 });
    console.log(`${p.name.padEnd(9)} ok  ${String(Date.now() - t).padStart(5)}ms  ${res.model}  → ${res.text.replace(/\s+/g, " ").slice(0, 80)}`);
  } catch (e) {
    console.log(`${p.name.padEnd(9)} FAIL ${String(Date.now() - t).padStart(5)}ms  ${String(e).slice(0, 160)}`);
  }
}
