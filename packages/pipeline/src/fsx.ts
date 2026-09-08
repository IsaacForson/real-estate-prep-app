import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";

export function writeText(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}
export function writeYaml(path: string, value: unknown) {
  writeText(path, YAML.stringify(value, { lineWidth: 100 }));
}
export function readYaml<T = unknown>(path: string): T {
  return YAML.parse(readFileSync(path, "utf8")) as T;
}
export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
export function writeJson(path: string, value: unknown) {
  writeText(path, JSON.stringify(value, null, 2));
}
export function listFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => join(dir, f)).sort();
}
export { existsSync };
