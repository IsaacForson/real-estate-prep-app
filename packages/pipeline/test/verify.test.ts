import { describe, it, expect } from "vitest";
import { quoteAppears, htmlToText, slugify } from "../src/statutes.js";
import { cognitiveMixFor } from "../src/plan.js";

describe("statute helpers", () => {
  it("finds quotes despite whitespace/punctuation/casing differences", () => {
    const statute = "(1) A sales associate shall deliver the deposit to the broker or employer no later than the end of the next business day following receipt.";
    expect(quoteAppears("deliver the deposit to the broker or employer no later than the end of the next business day", statute)).toBe(true);
    expect(quoteAppears("Deliver   the deposit, to the broker or employer no later than the end of the NEXT business day", statute)).toBe(true);
    expect(quoteAppears("within three business days following receipt", statute)).toBe(false);
    expect(quoteAppears("short", statute)).toBe(false);
  });
  it("strips html", () => {
    const t = htmlToText("<div><p>475.25&nbsp;Discipline.</p><script>x()</script><p>(1) The commission may</p></div>");
    expect(t).toContain("475.25 Discipline.");
    expect(t).toContain("(1) The commission may");
    expect(t).not.toContain("x()");
    expect(t).not.toContain("<");
  });
  it("slugifies citations", () => {
    expect(slugify("Fla. Stat. § 475.25")).toBe("fla-stat-s-475-25");
  });
});

describe("cognitive mix", () => {
  it("defaults to 30/50/20 and sums to count", () => {
    const m = cognitiveMixFor(8);
    expect(m.knowledge + m.application + m.analysis).toBe(8);
    expect(m.application).toBe(4);
  });
  it("honours a blueprint split", () => {
    const m = cognitiveMixFor(10, { knowledge: 2, application: 3, analysis: 0 });
    expect(m).toEqual({ knowledge: 4, application: 6, analysis: 0 });
  });
});

import { cleanUscText } from "../src/statutes.js";
describe("cleanUscText", () => {
  it("drops editorial/statutory notes but keeps section text and decodes entities", () => {
    const src = [
      "§1601. Congressional findings", "", "(a) Informed use of credit", "The Congress finds &mdash; that x.", "",
      "Editorial Notes", "", "Amendments", "1976 &mdash;Pub. L. 94&ndash;240 designated.", "",
      "Statutory Notes and Related Subsidiaries", "Short Title", "This Act may be cited as...", "",
      "§1602. Definitions", "(a) The Bureau means &sect; 1602.",
    ].join("\n");
    const out = cleanUscText(src);
    expect(out).toContain("§1601. Congressional findings");
    expect(out).toContain("The Congress finds — that x.");
    expect(out).not.toContain("Amendments");
    expect(out).not.toContain("Short Title");
    expect(out).toContain("§1602. Definitions");
    expect(out).toContain("§ 1602");
  });
});
