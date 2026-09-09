/**
 * Content hashing for the source watch and the remote publish manifest.
 * Whitespace-normalised so a re-flowed page (extra blank lines, tabs vs spaces, CRLF) does not
 * read as a statute change; anything else — a changed word, a renumbered section — does.
 */
import { createHash } from "node:crypto";

export function normalizeForHash(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha256 of the whitespace-normalised text — the value stored as `source_sha256` / `text_sha256`. */
export function textHash(text: string): string {
  return sha256Hex(normalizeForHash(text));
}
