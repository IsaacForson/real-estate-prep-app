import { describe, it, expect } from "vitest";
import { refMatchesDoc, sectionKey, sliceSection, resolveRefs, locateQuote, excerptAround } from "../src/cite.js";
import type { StatuteDoc } from "../src/statutes.js";

describe("refMatchesDoc", () => {
  const tx = "Tex. Occ. Code ch. 1101", tila = "15 U.S.C. §§ 1601–1667f (TILA)", rep = "REP Ref. Contracts", fl = "Fla. Stat. § 475.25";
  it("matches section refs to their chapter doc", () => {
    expect(refMatchesDoc("Tex. Occ. Code § 1101.652(b)", tx)).toBe(true);
    expect(refMatchesDoc("Tex. Occ. Code § 1102.001", tx)).toBe(false);
    expect(refMatchesDoc("22 Tex. Admin. Code § 535.2", tx)).toBe(false);
  });
  it("matches U.S.C. sections within a range and aliases", () => {
    expect(refMatchesDoc("15 U.S.C. § 1635(a)", tila)).toBe(true);
    expect(refMatchesDoc("15 U.S.C. § 1691", tila)).toBe(false);
    expect(refMatchesDoc("TILA", tila)).toBe(true);
    expect(refMatchesDoc("TILA § 1638", tila)).toBe(true);
    expect(refMatchesDoc("RESPA", tila)).toBe(false);
  });
  it("matches reference notes with or without a section", () => {
    expect(refMatchesDoc("REP Ref. Contracts § 2.3", rep)).toBe(true);
    expect(refMatchesDoc("REP Ref. Contracts", rep)).toBe(true);
    expect(refMatchesDoc("REP Ref. Agency § 1", rep)).toBe(false);
  });
  it("matches a section-level doc from a subsection ref", () => {
    expect(refMatchesDoc("Fla. Stat. § 475.25(1)(b)", fl)).toBe(true);
    expect(refMatchesDoc("Fla. Stat. § 475.01", fl)).toBe(false);
  });
});

describe("sectionKey + sliceSection", () => {
  it("extracts keys more specific than the doc root", () => {
    expect(sectionKey("Tex. Occ. Code § 1101.652(b)", "Tex. Occ. Code ch. 1101")).toBe("1101.652");
    expect(sectionKey("15 U.S.C. § 1635(a)", "15 U.S.C. §§ 1601–1667f (TILA)")).toBe("1635");
    expect(sectionKey("REP Ref. Contracts § 2.3", "REP Ref. Contracts")).toBe("2.3");
    expect(sectionKey("TILA", "15 U.S.C. §§ 1601–1667f (TILA)")).toBeNull();
    expect(sectionKey("Tex. Occ. Code ch. 1101", "Tex. Occ. Code ch. 1101")).toBeNull();
  });
  it("slices a govinfo section up to the next heading", () => {
    const text = "§1634. Other.\n\nStuff.\n\n§1635. Right of rescission\n\n(a) Disclosure of obligor's right to rescind\n\nExcept as otherwise provided...\n\n(b) Return of money\n\nWhen an obligor exercises...\n\n§1636. Repealed.\n\nSection 1636 was repealed.";
    const s = sliceSection(text, "1635")!;
    expect(s.startsWith("§1635. Right of rescission")).toBe(true);
    expect(s).toContain("Return of money");
    expect(s).not.toContain("§1636");
  });
  it("slices a Texas-style section and a reference-note section", () => {
    const tx = "Sec. 1101.651. CERTAIN PRACTICES. (a) text.\n\nSec. 1101.652. GROUNDS FOR SUSPENSION. (a) The commission may suspend...\n(b) more.\n\nSec. 1101.653. ADDITIONAL GROUNDS. text.";
    expect(sliceSection(tx, "1101.652")).toBe("Sec. 1101.652. GROUNDS FOR SUSPENSION. (a) The commission may suspend...\n(b) more.");
    const note = "## § 2 Elements\n\n### § 2.3 Consideration\n\nConsideration is...\n\n### § 2.4 Legality\n\nLegal purpose...";
    expect(sliceSection(note, "2.3")).toBe("### § 2.3 Consideration\n\nConsideration is...");
  });
  it("returns null when the key is absent", () => {
    expect(sliceSection("nothing here", "9999")).toBeNull();
  });
});

const doc = (citation: string, text: string, slug = citation): StatuteDoc => ({ jurisdiction: "NAT", citation, title: "t", url: null, fetched_on: "2026-09-08", text, slug });

describe("resolveRefs", () => {
  it("slices section refs, includes whole doc for doc-level refs, reports unmatched", () => {
    const tila = doc("15 U.S.C. §§ 1601–1667f (TILA)", "§1601. Findings\n\nA.\n\n§1635. Rescission\n\nB text.\n\n§1638. Disclosures\n\nC text.");
    const rep = doc("REP Ref. Contracts", "## § 1 Intro\n\nHello.");
    const r = resolveRefs(["15 U.S.C. § 1635", "REP Ref. Contracts", "RESPA"], [tila, rep]);
    expect(r.unmatched).toEqual(["RESPA"]);
    expect(r.text).toContain("§1635. Rescission");
    expect(r.text).not.toContain("§1638");
    expect(r.text).toContain("Hello.");
    expect(r.slugs.sort()).toEqual(["15 U.S.C. §§ 1601–1667f (TILA)", "REP Ref. Contracts"].sort());
  });
});

describe("locateQuote + excerptAround", () => {
  it("finds the doc holding the quote and returns its enclosing section", () => {
    const a = doc("A", "§1. One\n\nalpha text here.\n\n§2. Two\n\nThe broker shall deliver the deposit promptly to the escrow agent.\n\n§3. Three\n\ngamma.");
    const b = doc("B", "unrelated");
    const hit = locateQuote([b, a], "deliver the deposit promptly")!;
    expect(hit.doc.citation).toBe("A");
    const ex = excerptAround(hit.doc.text, hit.index);
    expect(ex).toContain("The broker shall deliver");
  });
});

describe("hyphenated section numbers (SC/OK/SD style)", () => {
  it("treats hyphens as part of the number and en-dash/'to' as ranges", () => {
    expect(refMatchesDoc("S.C. Code Ann. § 40-57-135", "S.C. Code Ann. § 40-57-10 et seq.")).toBe(true); // et seq. root
    expect(refMatchesDoc("S.C. Code Ann. § 40-58-135", "S.C. Code Ann. § 40-57-10 et seq.")).toBe(false);
    expect(refMatchesDoc("S.C. Code Ann. § 40-57-135", "S.C. Code Ann. §§ 40-57-10 – 40-57-400 (Title 40 ch. 57)")).toBe(true);
    expect(refMatchesDoc("Okla. Stat. tit. 59, § 858-312", "Okla. Stat. tit. 59 §§ 858-101 to 858-605 (Real Estate License Code)")).toBe(true);
    expect(refMatchesDoc("Okla. Stat. tit. 59, § 859-312", "Okla. Stat. tit. 59 §§ 858-101 to 858-605 (Real Estate License Code)")).toBe(false);
    expect(refMatchesDoc("S.D. Codified Laws § 36-21A-71", "S.D. Codified Laws ch. 36-21A")).toBe(true);
    expect(sectionKey("S.D. Codified Laws § 36-21A-71", "S.D. Codified Laws ch. 36-21A")).toBe("36-21A-71");
  });
  it("slices a hyphenated-number section without stopping at numbered paragraphs", () => {
    const text = "40-57-130. Applications.\n\n(A) text.\n\n40-57-135. Duties.\n\n(A) A licensee shall:\n\n1. Keep records.\n\n2. Deliver copies.\n\n(B) more.\n\n40-57-137. Trust accounts.\n\ntext.";
    const s = sliceSection(text, "40-57-135")!;
    expect(s).toContain("2. Deliver copies.");
    expect(s).toContain("(B) more.");
    expect(s).not.toContain("40-57-137");
  });
  it("govinfo slice does not end at a numbered paragraph inside the section", () => {
    const text = "§1635. Right of rescission\n\n(a) text\n\n1. First item here.\n\n(b) Return of money\n\n§1636. Repealed.";
    const s = sliceSection(text, "1635")!;
    expect(s).toContain("(b) Return of money");
    expect(s).not.toContain("§1636");
  });
});


describe("real-world citation forms from the state caches", () => {
  it("et seq. roots", () => {
    expect(refMatchesDoc("Alaska Stat. § 08.88.037", "Alaska Stat. § 08.88.011 et seq.")).toBe(true);
    expect(refMatchesDoc("12 Alaska Admin. Code § 64.170", "12 Alaska Admin. Code § 64.010 et seq.")).toBe(true);
    expect(refMatchesDoc("Va. Code Ann. § 54.1-2106.1", "Va. Code Ann. § 54.1-2100 et seq.")).toBe(true);
    expect(refMatchesDoc("Va. Code Ann. § 54.1-2106.1", "Va. Code Ann. § 54.1-2345 et seq.")).toBe(false);
    expect(refMatchesDoc("18 VAC 135-20-160", "18 VAC 135-20-10 et seq.")).toBe(true);
    expect(refMatchesDoc("18 VAC 135-20-160", "18 VAC 135-50-10 et seq.")).toBe(false);
    expect(refMatchesDoc("W. Va. Code § 30-40-18", "W. Va. Code § 30-40-1 et seq.")).toBe(true);
    expect(refMatchesDoc("W. Va. Code R. § 174-1-19", "W. Va. Code § 30-40-1 et seq.")).toBe(false);
    expect(refMatchesDoc("Ark. Code Ann. § 17-42-205", "Ark. Code Ann. § 17-42-101 et seq.")).toBe(true);
    expect(refMatchesDoc("Colo. Rev. Stat. § 12-10-206", "Colo. Rev. Stat. § 12-10-201 et seq.")).toBe(true);
  });
  it("chapter number as section prefix and semicolon-joined citations", () => {
    expect(refMatchesDoc("Del. Code Ann. tit. 24, § 2903", "Del. Code Ann. tit. 24, ch. 29")).toBe(true);
    expect(refMatchesDoc("Del. Code Ann. tit. 24, § 3003", "Del. Code Ann. tit. 24, ch. 29")).toBe(false);
    expect(refMatchesDoc("Mo. Rev. Stat. § 339.010", "Mo. Rev. Stat. ch. 339; 20 CSR 2250 (MREC Statutes and Rules)")).toBe(true);
    expect(refMatchesDoc("20 CSR 2250-2.010", "Mo. Rev. Stat. ch. 339; 20 CSR 2250 (MREC Statutes and Rules)")).toBe(true);
    expect(refMatchesDoc("Cal. Civ. Code § 658", "Cal. Bus. & Prof. Code §§ 10000-10036")).toBe(false);
    expect(refMatchesDoc("Cal. Bus. & Prof. Code § 10176", "Cal. Bus. & Prof. Code §§ 10160–10249.93")).toBe(true);
  });
  it("aliases in parentheses are tried as citations", () => {
    expect(refMatchesDoc("4 CCR 725-1 ch. 5", "4 Colo. Code Regs. § 725-1 (4 CCR 725-1)")).toBe(true);
    expect(refMatchesDoc("Arkansas Real Estate Commission Rule 1.1", "Arkansas Real Estate Commission Rules (Rule 1 – Rule 15)")).toBe(true);
  });
});


describe("containers: titles, chapter lists, ranges with chapters", () => {
  it("chapter + section range: the range governs", () => {
    expect(refMatchesDoc("Conn. Gen. Stat. § 20-311a", "Conn. Gen. Stat. ch. 392, §§ 20-311 to 20-329")).toBe(true);
    expect(refMatchesDoc("Conn. Gen. Stat. § 20-330", "Conn. Gen. Stat. ch. 392, §§ 20-311 to 20-329")).toBe(false);
    expect(refMatchesDoc("17 DCMR § 2600", "17 DCMR ch. 26, §§ 2600–2699")).toBe(true);
  });
  it("comma list of chapters is alternatives; title + chapter are hierarchical", () => {
    const sd = "S.D. Codified Laws chs. 36-1C, 43-15A, 43-15B, 43-32, 43-16, 43-4 (related real estate statutes)";
    expect(refMatchesDoc("S.D. Codified Laws § 36-1C-2", sd)).toBe(true);
    expect(refMatchesDoc("S.D. Codified Laws § 43-4-37", sd)).toBe(true);
    expect(refMatchesDoc("S.D. Codified Laws § 36-21A-71", sd)).toBe(false);
    expect(refMatchesDoc("02-039 C.M.R. ch. 340", "02-039 C.M.R. chs. 300–410 (Maine Real Estate Commission rules)")).toBe(true);
    expect(refMatchesDoc("Okla. Stat. tit. 41, § 115", "Okla. Stat. tit. 59 (Oklahoma Real Estate License Code, §§ 858-101 to 858-605)")).toBe(false);
    expect(refMatchesDoc("Okla. Stat. tit. 59, § 858-312", "Okla. Stat. tit. 59 (Oklahoma Real Estate License Code, §§ 858-101 to 858-605)")).toBe(true);
  });
  it("plural-insensitive words", () => {
    expect(refMatchesDoc("Colorado Real Estate Commission Position Statement CP-2", "Colorado Real Estate Commission Position Statements (CP-1 et seq.)")).toBe(true);
  });
});


describe("keys without a section sign and table-of-contents headings", () => {
  it("uses the most specific number when the ref has no §", () => {
    expect(sectionKey("20 CSR 2250-2.010", "Mo. Rev. Stat. ch. 339; 20 CSR 2250 (MREC Statutes and Rules)")).toBe("2250-2.010");
    expect(sectionKey("18 VAC 135-20-160", "18 VAC 135-20-10 et seq.")).toBe("135-20-160");
    expect(sectionKey("02-039 C.M.R. ch. 340", "02-039 C.M.R. chs. 300–410 (Maine rules)")).toBe("340");
    expect(sectionKey("Mo. Rev. Stat. ch. 339", "Mo. Rev. Stat. ch. 339; 20 CSR 2250 (MREC Statutes and Rules)")).toBeNull();
  });
  it("prefers the body heading over the table-of-contents line and accepts code prefixes", () => {
    const text = [
      "339.010 Definitions--applicability of chapter", "339.020 License required", "",
      "339.010. Definitions — inapplicability of chapter.", "1. As used in sections 339.010 to 339.180, the following terms mean:", "(1) \"Advertising\"...", "",
      "339.020. License required.", "It is unlawful...", "",
      "20 CSR 2250-2.010 Definitions", "PURPOSE: This rule defines terms.", "(1) Broker means...", "",
      "20 CSR 2250-2.020 Reinstatement", "text",
    ].join("\n");
    const a = sliceSection(text, "339.010")!;
    expect(a.startsWith("339.010. Definitions")).toBe(true);
    expect(a).toContain("Advertising");
    expect(a).not.toContain("339.020.");
    const b = sliceSection(text, "2250-2.010")!;
    expect(b.startsWith("20 CSR 2250-2.010 Definitions")).toBe(true);
    expect(b).toContain("Broker means");
    expect(b).not.toContain("2250-2.020");
  });
});


describe("range starts, container keys, letter-prefixed numbers, dashes, parent fallback", () => {
  it("a range start is a real section, not the root", () => {
    expect(sectionKey("CERCLA § 9601", "42 U.S.C. §§ 9601–9628 (CERCLA)")).toBe("9601");
    expect(sectionKey("Conn. Gen. Stat. § 20-311", "Conn. Gen. Stat. ch. 392, §§ 20-311 to 20-329")).toBe("20-311");
    expect(sectionKey("Sherman Act § 1", "15 U.S.C. §§ 1–7 (Sherman Act)")).toBe("1");
  });
  it("a container after a root § is the key", () => {
    expect(sectionKey("4 Colo. Code Regs. § 725-1, ch. 6", "4 Colo. Code Regs. § 725-1 (4 CCR 725-1)")).toBe("6");
  });
  it("letter-prefixed numbers", () => {
    expect(refMatchesDoc("Colorado Real Estate Commission Position Statement CP-2", "Colorado Real Estate Commission Position Statements (CP-1 et seq.)")).toBe(true);
    expect(sectionKey("Colorado Real Estate Commission Position Statement CP-2", "Colorado Real Estate Commission Position Statements (CP-1 et seq.)")).toBe("CP-2");
    expect(refMatchesDoc("Ariz. Admin. Code R4-28-101", "Ariz. Admin. Code R4-28-101 et seq.")).toBe(true);
    expect(refMatchesDoc("Ariz. Admin. Code R4-28-1101", "Ariz. Admin. Code R4-28-101 et seq.")).toBe(true);
  });
  it("en-dash section numbers and parent fallback", () => {
    const md = "§ 17–322. Grounds.\n\ntext a\n\n§ 17–323. Penalties.\n\n(a) In general...\n\n§ 17–324. Hearings.\n\ntext c";
    expect(sliceSection(md, "17-323")).toBe("§ 17–323. Penalties.\n\n(a) In general...");
    const comar = "09.11.01 General Regulations\n\n.01 Scope.\n\nA. text\n\n.19 Trust money.\n\nB. text\n\n09.11.02 Code of Ethics\n\n.01 Scope.";
    const s = sliceSection(comar, "09.11.01.19")!;
    expect(s.startsWith("09.11.01 General Regulations")).toBe(true);
    expect(s).toContain("Trust money");
    expect(s).not.toContain("Code of Ethics");
  });
});
