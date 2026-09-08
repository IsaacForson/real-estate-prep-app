#!/usr/bin/env node
// `pnpm -r typecheck` runs this. edge functions are deno, not tsc: run `deno check` when deno
// is installed, otherwise warn and exit 0 so machines without deno (e.g. the content-only CI
// workflow) still pass. an api CI job should install deno and run `deno task check` directly.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const probe = spawnSync("deno", ["--version"], { stdio: "ignore" });
if (probe.error) {
  console.warn("[apps/api] deno not found; skipping edge function typecheck (install: https://deno.land)");
  process.exit(0);
}
const run = spawnSync("deno", ["task", "check"], { cwd: root, stdio: "inherit" });
process.exit(run.status ?? 1);
