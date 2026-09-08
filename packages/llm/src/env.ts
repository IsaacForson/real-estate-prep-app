/** Minimal .env loader (no dependency): walks up from cwd to the pnpm workspace root. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const p = join(repoRoot(), ".env");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
