import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";

/** Repo root = nearest ancestor with pnpm-workspace.yaml, so the CLI works from any cwd. */
export function repoRoot(from = process.cwd()): string {
  let d = resolve(from);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, "pnpm-workspace.yaml"))) return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return resolve(from);
}

const ROOT = repoRoot();

export const CONFIG = {
  model: process.env.PIPELINE_MODEL ?? "claude-opus-5",
  contentDir: resolve(ROOT, process.env.CONTENT_DIR ?? "content"),
  stateDir: resolve(ROOT, process.env.PIPELINE_STATE_DIR ?? ".pipeline"),
  /** Items requested per drafting call. Keeps each response well under max_tokens. */
  itemsPerCall: 8,
  promptVersion: "draft-v3 / verify-v1",
} as const;
