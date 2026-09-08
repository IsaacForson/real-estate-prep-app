import { describe, it, expect } from "vitest";
import { extractJson } from "../src/json.js";
import { estimateTokens } from "../src/providers.js";

describe("extractJson", () => {
  it("parses plain, fenced, and prefixed JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Here you go:\n```json\n{"items":[{"x":"}"}]}\n```')).toEqual({ items: [{ x: "}" }] });
    expect(extractJson('reasoning... {"a":{"b":[1,2]}} trailing')).toEqual({ a: { b: [1, 2] } });
    expect(() => extractJson("no json here")).toThrow();
  });
  it("estimates tokens conservatively", () => {
    expect(estimateTokens("a".repeat(3600))).toBe(1000);
  });
});
