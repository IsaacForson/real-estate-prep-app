# Ground-truth gaps — manual ingestion checklist

Generated from the blueprint/ingestion agents' reports on 2026-09-08. A state cannot be drafted
until its blueprint refs resolve to cached text (`pnpm pipeline refs-audit XX --verbose`). Everything
below was blocked to scripted fetch from this network; each needs a human to download the official
PDF/HTML once and run `pnpm pipeline ingest XX "<citation root>" --file <path> "<title>" --url "<official url>"`.
Prefer the commission's own compiled "license law and rules" book when the legislature site blocks.

## Nothing cached (blueprint exists, 0% refs resolve)

| State | Missing | Official source that blocked | Notes |
|---|---|---|---|
| CA | Cal. Civ. Code sections cited by the outline (B&P Code div. 4 and 10 CCR are cached) | leginfo.legislature.ca.gov (only Civil Code pages were not fetched) | Fetch Civ. Code §§ 658–663, 1013, 1102 et seq., 2079 et seq., 1710.2 |
| MA | M.G.L. c. 112 §§ 87PP–87DDD; 254 CMR | malegislature.gov (ECONNREFUSED); mass.gov (403) | Board of Registration publishes no compiled PDF found |
| MI | MCL 339.2501 et seq. (Occupational Code art. 25); Mich. Admin. Code R 339.22101 et seq. | legislature.mi.gov (Check Point WAF 403); ars.apps.lara.state.mi.us (403) | LARA licensing guide PDF also 403 |
| NV | NRS 645; NAC 645 | leg.state.nv.us (Cloudflare 403) | NRED "Law and Reference Guide" is commentary, not the statute |
| NH | RSA 331-A; N.H. Code Admin. R. Rea 100–1000 | gc.nh.gov (WAF 403); gencourt.state.nh.us (403) | |
| NJ | N.J.S.A. 45:15-1 et seq.; N.J.A.C. 11:5 | njleg.state.nj.us / lis / pub (refused) | DOBI links only to legislature + LexisNexis |
| OH | ORC ch. 4735; OAC 1301:5 | codes.ohio.gov (timeout); legislature.ohio.gov (timeout); com.ohio.gov (JS shell) | |
| TN | T.C.A. 62-13; Tenn. Comp. R. & Regs. 1260 | LexisNexis host; publications.tnsosfiles.com (CloudFront 403) | |
| TX | Tex. Occ. Code ch. 1101, 1102; 22 TAC pt. 23 (TREC rules) | statutes.capitol.texas.gov (JS app); trec.texas.gov (timeout); SOS TAC (JS) | Download TREC's compiled "TRELA and Rules" PDF |
| UT | Utah Code 61-2f; Utah Admin. Code R162-2f | le.utah.gov (ECONNREFUSED); adminrules.utah.gov (JS); realestate.utah.gov (403) | |
| WI | Wis. Stat. ch. 452; Wis. Admin. Code REEB | docs.legis.wisconsin.gov (refused all connections) | |

## Partially cached (rules or a companion act missing)

| State | Cached | Missing |
|---|---|---|
| AZ | ARS 32-2101 to 32-2199.05 (8 article files) | A.A.C. Title 4 ch. 28 (Commissioner's Rules) — apps.azsos.gov Cloudflare 403; azre.gov 403 |
| CO | C.R.S. 12-10 (via DORA manual), 4 CCR 725-1, Position Statements | nothing critical; C.R.S. is the DORA manual copy, re-fetch from an official code host when possible |
| CT | CGS ch. 392; Regs. §§ 20-328-1a–33 | companion acts cited (CGS 47a landlord-tenant, 46a fair housing) |
| DC | D.C. Code §§ 47-2853.141–.199; 17 DCMR ch. 26 | D.C. Code §§ 47-2853.01–.27 (general licensing provisions); Title 42 fund/TOPA sections |
| DE | 24 Del. C. ch. 29; 24 DE Admin. Code 2900 | tit. 6 (consumer fraud), tit. 25 (landlord-tenant), tit. 29 refs |
| GA | GREC rule PDFs 520-1-.02, -.04, -.05 only | O.C.G.A. 43-40 (LexisNexis viewer only); remaining 520-1 rules (rules.sos.ga.gov 403) — **largest gap in a top-5 state** |
| HI | HRS ch. 467; HAR 16-99 | HRS 508D, 514B, 521 (capitol.hawaii.gov 403) |
| IN | 876 IAC arts. 1–9 | IC 25-34.1 (iga.in.gov JS app) |
| KS | K.S.A. 58-3034–3087, BRRETA | K.A.R. 86 (krec.ks.gov 403) |
| LA | La. R.S. 37:1430–1470; La. R.S. 9:3891–3899 | La. Admin. Code 46:LXVII (doa.la.gov Cloudflare 403) |
| MN | Minn. Stat. ch. 82; Minn. R. 2805 | Minn. Stat. ch. 45 (Commerce Dept. general), 513 (disclosure), 82B |
| MT | MCA 37-51; ARM 24.210 | companion titles 70–76 |
| NC | 21 NCAC 58A (15 docs) | G.S. 93A (ncleg.gov Cloudflare 403) |
| NE | License Act (OCR of scanned manual), Title 299/305, agency §§ 76-2401–2430 | Nebraska Fair Housing Act 20-301 et seq.; Title 301 |
| OK | 59 O.S. 858; OAC 605 | 60 O.S. 831–839 (RPCDA), 41 O.S. (landlord-tenant), 15 O.S. 136 |
| OR | OAR 863 (via OREA permanent-rule filing) | ORS 696 (oregonlegislature.gov timeout) |
| PA | 49 Pa. Code ch. 35; 68 Pa.C.S. 7301–7315 | RELRA 63 P.S. § 455.101 et seq. (palegis.us blocked) |
| RI | 230-RICR-30-20-2 | R.I. Gen. Laws 5-20.5 (rilegislature.gov timeout; dbr.ri.gov Cloudflare) |
| SC | S.C. Code 40-57; Regs. ch. 105 | companion acts cited (27-50 disclosure, 27-40 landlord-tenant) |
| VT | 26 V.S.A. ch. 41; 3 V.S.A. ch. 5 | OPR Real Estate Commission rules (outside.vermont.gov F5 403 — appears geo-blocked; try from a US network) |
| WV | W. Va. Code 30-40; 174 CSR 1–7 | W. Va. Code 5-11A (fair housing) |

## Fetched from Internet Archive captures of the official URL (re-fetch live when reachable)

FL (Fla. Stat. ch. 475, FREC Law Book 61J2), ID (Idaho Code 54-20), IL (225 ILCS 454, 68 IAC 1450),
KY (KRS 324, 201 KAR 11). The text is the official publication, but the capture date is what
`fetched_on` should be read as; confirm against the live source before the first draft.

## Text-quality caveats
- NE License Act is OCR of a scanned PDF (table of contents jumbled; sections spot-checked clean).
- MO's single 440K-char rulebook combines statute + rules; slicing works because refs are section-level.
- NY has no published outline; the blueprint is weights-only (percentage points) with a provisional 100 items.
- VT `scored_items: 40` is provisional — the state exam has no public outline.
