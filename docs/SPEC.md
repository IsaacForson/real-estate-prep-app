# US Real Estate Licensing Exam Prep — Full Build Specification

**Author:** research compiled for Forson, September 2026

**Status:** pre-build. Every figure marked ⚠ must be re-verified against the primary source before launch.

---

## 1. The Positioning

**One sentence:** The only real estate exam prep that covers all 50 state portions, cites the statute behind every answer, and costs one payment forever.

Three things make this defensible, and all three came out of the review data rather than a brainstorm:

**1. The state portion is the abandoned half of the exam.**

Every US real estate exam is two tests. State portions reward precision — a candidate who knows the general principle but misremembers the specific statute, timeline or disclosure requirement loses points — which is why state-portion failure rates often exceed national-portion failure rates. Virginia's national portion (80 questions, 70% to pass) is described as manageable with standard prep; the state portion (40 questions, 75%) is where most candidates fall short.

Incumbents own the national portion and have effectively abandoned the state portion. Their own users say so, at 4 and 5 stars:

> "I enjoyed using and passed the National part with this app the first time but why no help the the State portion? State help would earn 5 stars."

> "I am taking the NC Real Estate exam and it would be worth the money if the app had a state specific option."

> "I used this app for 90% of my studying besides the state specific material"

> "This will not prepare you for your state exam... the state portion is very incomplete."

**2. There is no single national exam either.**

Pearson VUE and PSI each build and weight their own national outline. Pearson VUE lists 21 US real estate programmes; PSI holds roughly 29 contracts and publishes no roster. Every competitor sells one blended "national" bank. You ship two, correctly weighted, and route the user to the right one based on their state's vendor. This is invisible to competitors and obvious to a candidate who sits the exam.

**3. Price and packaging as the wedge.**

The single loudest complaint theme across every incumbent is the paywall. Verbatim: *"I paid the 29. But can only access 10 questions a day unless I pay more. It blocks out any explanation of the answers unless I pay more."* / *"$34.95 a month is crazy!"* / *"DO NOT DO THE 3 DAY TRIAL!!!! They'll charge you as soon as you sign up."*

---

## 2. Market and Unit Economics

⚠ All candidate counts and pass rates below come from secondary aggregators. Verify against ARELLO and individual state commission annual reports before committing marketing spend.

| State | Candidates/yr | 1st-attempt pass | Notes |

|---|---|---|---|

| Texas | 92,720 | ~59% | 180 hrs prelicensing |

| California | 46,500 | ~51% | DRE administers; hardest state portion |

| Florida | 41,900 | ~47–51% | 100q split 45 national / 55 state |

National first-attempt pass rate sits between 50% and 60%, average 61.4% with a 7.5-point standard deviation. Even in the best-performing states an estimated 30–40% of first-timers fail.

**The retake market is your best customer.** Roughly 4 in 10 candidates fail. They pay the retake fee again (Virginia $60, California $100, Georgia $175 non-refundable), they search with high intent, and they know exactly which portion beat them. Marketing to "failed the state portion" is a sharper hook than "pass your exam."

**Sizing.** Big-three states alone are ~181,000 candidates/year. At a $59 one-time price:

| Penetration | Annual revenue |

|---|---|

| 0.5% | $53K |

| 1% | $107K |

| 2% | $214K |

| 5% | $534K |

Full 50-state coverage roughly doubles the addressable pool. This is a real business at 1–2%, not a lottery ticket, but it is not a business at 0.1%.

---

## 3. Content Architecture

### 3.1 The three blueprint layers

```

BANK

├── national_pearsonvue   (80 scored items, 8 domains)   ~900 questions

├── national_psi          (PSI-weighted outline)          ~900 questions

└── state_{XX}            × 50 + DC                       ~400 each  → ~20,400

                                                    TOTAL ≈ 22,200

```

### 3.2 Pearson VUE national/general salesperson blueprint

Source: Pearson VUE publishes this as a free PDF (document 099913). 80 scored items plus 5 unscored pretest items. Domain weights for the salesperson exam:

| # | Domain | Items |

|---|---|---|

| I | Real property characteristics, legal descriptions, property use | 9 |

| II | Forms of ownership, transfer, recording of title | 8 |

| III | Property value and appraisal | 11 |

| IV | Real estate contracts and agency | 16 |

| V | Real estate practice | 14 |

| VI | Property disclosures and environmental issues | 8 |

| VII | Financing and settlement | 7 |

| VIII | Real estate math calculations | 7 |

The broker outline is in the same PDF with different weights (contracts and agency rises to 17, practice to 13, math to 8). Each domain is further broken into lettered subtopics with their own item counts, and the PDF also classifies items as Knowledge / Application / Analysis. **Mirror that cognitive split in your bank** — it is the reason competitors' questions "feel" wrong. A domain needing 3 analysis items and 2 knowledge items should not be filled with five recall questions.

**Do not paste the outline into your app.** It is Pearson VUE's copyrighted document. Use it as the internal blueprint, and cite it as your source in marketing ("blueprint-matched to the published Pearson VUE content outline"). Never imply endorsement — the PDF itself states Pearson VUE does not endorse any prelicensing provider.

### 3.3 State blueprints

Each state commission and vendor publishes a candidate information bulletin with its own state-portion outline. Pennsylvania's, for example, breaks its broker state portion into 40 scored items across sections with explicit counts — Real Estate Commission (4 items), Licensure (6 items), Agency and Disclosure (10 items), and so on.

**Nobody has published an accurate 50-state map of vendor, question counts, time limits and pass scores.** Pearson VUE's A–Z list shows 21 programmes; PSI publishes no roster; some states self-administer. Building this map correctly *is* part of your moat. Known ranges across sampled states: 100–152 total questions, 180–240 minutes, pass scores 70–75%.

**Deliverable 0 — build this table before anything else.** One row per state:

```

state, vendor, national_items, state_items, total_time_min,

pass_score_national, pass_score_state, retake_policy, exam_fee,

prelicense_hours, statute_citation_root, bulletin_url, last_verified

```

Source every row from the state commission site or the vendor's candidate bulletin. Never from a blog. Store `last_verified` and re-check quarterly.

### 3.4 Where the content legitimately comes from

| Layer | Source | Status |

|---|---|---|

| Topic weights | Vendor content outlines (public PDFs) | Copyrighted — use as blueprint, never reproduce |

| State law ground truth | State statutes and commission administrative rules | US government edicts, not copyrightable |

| National law ground truth | Federal statute (Fair Housing Act, RESPA, TILA/Reg Z, ECOA, CERCLA) | Public domain |

| Questions | **You author every one** | Yours |

**Absolute rules.** Never copy, paraphrase, or "reword" a question from a competitor's bank, a textbook, or a leaked exam file. Never use recalled real exam items. Never use the trademarks of PSI, Pearson VUE, FREC, TREC, DRE or NAR in a way implying affiliation. Add a disclaimer identical in spirit to the ones the existing apps use.

Note the Pearson VUE outline lists reference textbooks (Dearborn's *Modern Real Estate Practice*, Mettling's *Principles of Real Estate Practice*, etc.). These tell you what the item writers read. Reading them for orientation is fine. Lifting from them is not.

### 3.5 The content production pipeline

22,000 verified questions is the whole business. Treat it as a factory, not a writing task.

```

1. INGEST     Pull the statute/rule text for a blueprint node.

              (FL Ch. 475 + FREC rules; TX Occupations Code Ch. 1101 + TREC rules; etc.)

2. DRAFT      LLM generates N candidate items constrained to that node,

              at the required cognitive level, each with a mandatory

              citation field pointing to a specific section.

3. VERIFY     Automated: does the cited section exist, and does its text

              actually support the keyed answer? Reject on failure.

4. LINT       Distractor quality checks — see 3.6.

5. HUMAN QA   Licensed reviewer signs off in batches. Sampled, not 100%.

6. PUBLISH    Item enters the bank with version, citation, and reviewer ID.

7. MONITOR    Track per-item p-value (% correct) in production. Items

              answered correctly by 95%+ or under 25% get re-reviewed.

```

Step 3 is what makes this defensible from Accra. You are not relying on your own real estate knowledge. You are relying on a chain of citation that any stranger can audit.

### 3.6 Distractor lint rules (learn from the competition's corpse)

The trade-exam apps are dying of exactly this. Real reviews:

> "the biggest answer is always the correct answer. Just pick the longest answer and you will get it right every time."

> "Volts Equal Current times Resistance not Current times Amperes. How many more are wrong?"

> "Has a lot of wrong answers use a different app"

Automated rejection rules before any item ships:

- Correct answer must not be the longest option more than 25% of the time across a domain

- No "all of the above" / "none of the above"

- All four options same grammatical form and within ±30% length of each other

- No absolute qualifiers (always, never) unless present in all four options

- No negatively-worded stems unless the negation is bolded

- Correct-answer position uniformly distributed A/B/C/D per domain

- Every item has a non-empty citation and a non-empty explanation

- No duplicate or near-duplicate stems (embedding similarity threshold)

Run this as CI on the content repo. A failing item cannot merge.

---

## 4. Feature Specification

Ranked by evidence strength from the review corpus (692 reviews pulled across the three leading apps; 23–34% of recent reviews at 1–3 stars despite displayed lifetime ratings of 4.77–4.91).

### 4.1 P0 — the wedge

**F1. All 50 states + DC, state portions.** The product's reason to exist.

**F2. Dual national banks.** Vendor-correct weighting, auto-selected from the user's state. Show the user which one they're on and why.

**F3. Statute citation on every answer.** Not a paragraph of prose — a citation to the exact section, tappable, with the relevant text inline. This simultaneously: kills the "wrong answers" death spiral, makes your bank auditable, and is a marketing claim no competitor can copy quickly.

**F4. Blueprint coverage meter.** Map mastery to real exam item counts. "Agency and Disclosure: you're solid on 7 of the 10 items this section will contain." This converts an abstract percentage into exam-day arithmetic and nobody does it.

**F5. Readiness score with an honest methodology page.** Predicted score on each portion separately, with confidence. State the method openly. This becomes your most-shared screenshot.

### 4.2 P0 — table stakes the incumbents do badly

**F6. Audio, done completely.** This is the single most-loved feature in the corpus and the single most-requested missing one. Users switched to Aceable specifically for it (*"Nothing was read to me, unlike Aceable that reads everything to you"*) and still complain it is unfinished:

> "the app needs controls for the speed of speech, 1.25x, 1.5x, 1.75x, 2x would be nice"

> "wish that I could pause the voice while taking notes"

> "I wish there was an option for the app to read the questions or note cards to you like in audible"

> "Just need an audio option for this to be read out loud. That would put the icing on the cake."

Requirements: questions, options, explanations and flashcards all narrated. Speed 0.75×–2.5×. Pause without losing position. Background and lock-screen playback with media controls. Auto-advance mode for hands-free study while driving or at the gym. Pre-generate audio server-side per item and ship as cached assets; do not rely on device TTS quality.

**F7. Offline-first, genuinely.** Explicitly requested (*"would be great if we could use the app offline"*) and it eliminates the failure mode currently wrecking the adjacent HVAC leader (*"actively loses network connection when taking quizzes, forcing you to close it out and reopen"*). Local-first data store, background sync, zero network calls on the study path.

**F8. Never lose progress.** Persist per-question, not per-session. *"it freezes constantly which means I have to start over what I was in the middle of."* Kill a session mid-question and it resumes on the same question.

**F9. A question runner that advances.** The most actionable review in the entire dataset: *"You answer ONE question and there's no way to click to the next question. You have to go back to the home page and start over for each question. Seriously the stupidest user interface I have ever seen."*

**F10. Red / yellow / green spaced repetition.** Users are already hand-rolling this: *"I take quizzes until they are all answered. I go to the yellow then the red. Once I have moved everything to green I retake repeatedly until I can answer e—"*. Build the Leitner box they are simulating with willpower. Surface the pipeline visually. Leech detection for items missed 4+ times, routed to a focused drill.

**F11. Full-length timed mocks in exact state format.** Correct question count, split, time limit and pass threshold per state. Research links completing 5–10 timed full-lengths to first-attempt success. Ship at least 5 distinct non-overlapping forms per state.

**F12. Dark mode.** *"this app will be awesome if the app can have night mode! Please add this feature!"*

**F13. No sign-in walls mid-session.** *"requiring the user to go through the sign-in process again. It's irritating, frustrating and needs an immediate fix, as study time is being interrupted every hour or so."* Long-lived refresh tokens. Never interrupt a study session to authenticate.

**F14. Tablet rotation.** Two separate reviews. Trivial, and it's in the top complaints for a paid app.

### 4.3 P1 — depth

**F15. Math workbench.** Math is 7 of 80 national items and the most-feared section. Every math item shows a full worked solution, not just the answer. Include a proration/amortization scratchpad. Note that Arkansas, Colorado, Idaho, Massachusetts and Wyoming ban personal calculators and provide an on-screen one — simulate that constraint in those states' mocks. ⚠ verify current.

**F16. Vocabulary layer.** Real estate is a vocabulary exam wearing a law exam's clothes. Auto-extracted glossary with audio, linked from every question.

**F17. Missed-question review queue.** Every wrong answer lands in a queue with its citation. Export as a PDF study sheet (watermarked — see §5).

**F18. Exam-day brief.** Per state: what ID to bring, calculator policy, retake rules and waiting period, fee, what happens if you pass only one portion. Sourced from the candidate bulletin. High-value, low-effort, and it earns organic links.

**F19. Multi-state.** Agents near borders license in 2–3 states (DC/MD/VA, NY/NJ/CT). Because the purchase covers all states, this is free differentiation.

**F20. Streaks and a study plan tied to the exam date.** User enters test date; app back-plans daily targets against blueprint coverage.

### 4.4 Explicitly out of scope

- Prelicensing course hours (state-approved education requires accreditation per state — that is the licensing bottleneck you are avoiding)

- Live tutoring, community forums, peer chat (human ops — see why the grief niche died)

- Video lessons at launch (expensive, and the corpus shows audio matters more)

---

## 5. Anti-Sharing / Entitlement Architecture

Your instinct is right, and this needs designing in from day one because a one-time price plus a shareable login is the worst combination. But the strongest defenses are product-design defenses, not DRM.

### 5.1 Threat model

| Threat | Severity | Primary defense |

|---|---|---|

| Credential sharing in a study group | High | Device binding + concurrency + personalised value |

| Account sold/posted publicly | Medium | Anomaly detection + soft lock |

| Bulk extraction of the question bank | High | Server-paced delivery, never ship the full bank |

| Screenshots reposted | Low | Ignore. Unwinnable and low impact. |

### 5.2 Design so sharing hurts the sharer — your strongest lever

Make the core value **personal state**, not static content. The SRS scheduler, the weak-topic diagnostics, the readiness score and the study plan are all computed from one person's answer history.

If five people share an account, the algorithm receives five people's answer patterns as if they were one. Everyone gets served the wrong questions. The readiness score becomes meaningless. Progress bars lie. The product degrades for the person who paid, and they stop sharing without you doing anything.

Surface this in the UI honestly, not as a threat: *"Your readiness score assumes one person is answering. Sharing this account will make it inaccurate."* This is more effective than a lockout and generates no support tickets.

### 5.3 Entitlement mechanics

**Device registry.** Bind entitlement to an account, allow 3 concurrently active devices. Self-service device removal with a 7-day cooldown per slot. A real user with a phone, a tablet and a laptop never hits this. A study group of six hits it on day one.

**Single active session token.** One live session per account. A second login invalidates the first with a clear message. Two people sharing will kick each other out repeatedly until one buys.

**Anomaly detection, soft response.** Flag on: more than 3 distinct device fingerprints in 30 days, logins from more than 3 geographic regions in 24 hours, or answer volume exceeding a plausible human ceiling. Response is a re-verification email, never a silent ban. Log everything; act conservatively. False-positive lockouts of paying customers will destroy your reviews faster than piracy will destroy your revenue.

**Disable Family Sharing on the IAP.** Apple lets you opt out per non-consumable product. Opt out. ⚠ verify current App Store policy.

### 5.4 Protecting the bank itself

Never ship all 22,000 items to a device.

- Server issues **session batches** — 50–200 items, signed, short TTL.

- Offline cache holds only: everything the user has already seen, plus a rolling look-ahead window sized to a few sessions. Encrypted at rest with a device-derived key.

- Rotate item IDs per user so scraped sets can't be trivially merged across accounts.

- Rate-limit item delivery to a plausible human ceiling per hour.

- Canary items: seed a small number of uniquely-worded items per account. If a bank appears elsewhere, the canaries identify the source account.

- Watermark any exported PDF with the buyer's account ID.

### 5.5 Price piracy out of existence

At $59 one-time with a 4–6 week study window, coordinating a shared login costs more social friction than the saving. Most piracy is a pricing signal. Keep the price low enough that buying is the path of least resistance, and spend your engineering time on F6 and F7 instead of DRM.

---

## 6. Pricing and Packaging

**The offer: $59, one time, everything, forever.**

All 50 states plus DC. Both national banks. Every question, every explanation, every mock. No daily limits. No upsells. All future content and state updates included.

This is a direct counter to the loudest complaint theme in the market, and it's a headline no incumbent can match without dismantling their own subscription revenue.

| Tier | Price | Contents |

|---|---|---|

| Free | $0 | 40 questions, full explanations and citations, 1 short mock, one state |

| **Complete** | **$59** | Everything, forever, all states |

| Pass guarantee add-on | +$20 | Full refund on proof of a failed attempt within 90 days |

**Why one-time beats subscription here.** The use window is 4–6 weeks. Subscriptions in a 4-week product read as traps, and the reviews prove users resent them: *"I'll use the app for the 2 months leading up to my test date and then unsubscribe right away."* One-time also removes churn management, cuts refund disputes, and stops the App Store review cycle that's punishing your competitors.

**"Forever" is cheap to promise** because users churn naturally the day they pass. Your marginal cost per lifetime user after month two is near zero.

**Free tier must be genuinely useful.** Full explanations and citations on all 40 free questions. The free tier's job is to prove the citation quality that justifies the price.

**Later, not at launch:** brokerage and real estate school site licences (seat-based, invoiced). That's the B2B revenue that makes this a real business, but it needs a track record first.

---

## 7. Getting Paid from Ghana

⚠ Verify all of this before writing code. If you cannot get paid, nothing else matters.

- **Stripe does not onboard sellers in Ghana.** Do not build on the assumption that it will.

- **Mobile in-app purchase** must route through StoreKit and Google Play Billing. RevenueCat is the standard abstraction and handles entitlement sync, receipt validation and cross-platform restore. Confirm Google Play and Apple developer payouts to a Ghanaian bank account, and confirm what tax forms Apple requires from a non-US seller (W-8BEN-E for Forsare Ventures Ltd).

- **Web sales** need a merchant of record. Paddle, Lemon Squeezy or Polar become the legal seller and handle global VAT and sales tax. Priced honestly for a non-US founder, Paddle runs around 7–8% all-in and Lemon Squeezy around 7.5%. Note Paddle has been reported to require three months of processing history to approve a new account — apply early.

- Registering Forsare Ventures Ltd as the seller entity materially improves your odds with all of them.

**Sell on web as well as in-app.** Web-first purchase avoids the 15–30% store commission on the sales you drive yourself, and lets you run a proper checkout. Keep IAP for store-discovered users.

---

## 8. Technical Architecture

Play to your actual strengths — this is a content-heavy, offline-first, cross-platform client problem, which is your day job.

**Client.** One codebase across iOS, Android and web. Given your Vue/Nuxt/Svelte background, Capacitor over a Nuxt or SvelteKit app is the lowest-risk path and gives you a real web product for free — which matters because web is where your SEO and margin live. React Native is the alternative if native audio background playback proves painful in a webview; validate that specific risk in week one, because F6 depends on it.

**Local store.** SQLite via a local-first sync layer. All study reads hit local. Sync is background and never blocks the UI.

**Backend.** Supabase or a small Postgres + edge function setup. Requirements are modest: auth, entitlement, item delivery, sync, analytics.

**Content repo.** Questions live in version-controlled files, not in a CMS. Every item is a record with:

```yaml

id: FL-475-0413

jurisdiction: FL

blueprint_node: "III.B.2"        # maps to the state outline

vendor: pearsonvue

cognitive_level: application     # knowledge | application | analysis

stem: "..."

options: [A, B, C, D]

key: B

explanation: "..."

citation:

  source: "Fla. Stat. § 475.25(1)(b)"

  url: "..."

  quoted_text: "..."

reviewer: "reviewer_id"

verified_on: 2026-09-01

version: 3

```

CI runs the §3.6 lint on every merge. Content ships like code.

**Audio.** Pre-generate per item with a good TTS voice at build time. Cache as assets. Do not use on-device TTS for the primary experience.

---

## 9. Distribution

**ASO is the whole game, and the structure favours you.** Every state is its own low-competition keyword. "Florida real estate exam prep", "Texas real estate exam prep", 51 separate search surfaces that no single app currently owns. Build one landing page per state per portion, each sourced from the official candidate bulletin, each with 10–15 free questions. That's ~100 pages of genuinely useful, genuinely unique content.

**The retake hook.** Roughly 40% of candidates fail. Target them explicitly: "Failed the state portion? That's the half nobody prepares you for." Search intent from a person who just failed and paid a retake fee is the highest-converting traffic in this market.

**Where they gather.** r/realtors, r/RealEstate, state-specific Facebook groups, and the comment sections of pass-rate articles. Do not spam. Answer state-specific exam questions accurately and cite the statute — your product's whole thesis is citation quality, so demonstrate it.

**The competitors' reviews are your ad copy.** Every complaint in §4 is a line: "Every explanation unlocked. No daily limit. One payment."

---

## 10. Build Sequence

The honest tension: you want all 50 states, and 22,000 verified questions is 12–18 months of content work. Resolve it by **shipping the 50-state architecture immediately and the 50-state content progressively**, with the one-time price making early buyers whole automatically.

In-app, per state, show the truth: *"Florida — 620 verified questions. Wyoming — in production, arriving Q2. You already own it."* Honesty here is a feature; the entire product is positioned on trustworthiness.

| Phase | Duration | Output |

|---|---|---|

| **0. Verify** | 2 weeks | Payment rails confirmed. 51-row state map built from primary sources. Employment contract checked. Background audio validated in your chosen stack. |

| **1. Engine** | 6 weeks | Content pipeline + lint CI. Client shell: offline store, question runner, SRS, audio, dark mode. Pearson VUE national bank (~900 items) as the pilot content. |

| **2. First states** | 6 weeks | FL, TX, CA state banks (~400 each). 5 mocks each. Readiness score. Web landing pages. **Soft launch at $39 founding price.** |

| **3. Harden** | 4 weeks | Entitlement + anti-sharing. PSI national bank. Pass guarantee. Act on early reviews. **Price to $59.** |

| **4. Scale content** | ongoing | 4–6 states per month, largest candidate pools first. NY, IL, GA, NC, OH, AZ, PA, WA, NJ, MI. |

| **5. B2B** | month 9+ | School and brokerage site licences once you have pass-rate evidence. |

**Hire for QA, don't partner.** Two or three recently licensed agents per major state, paid per batch on Upwork, red-teaming the bank. That is a contract, not a co-founder. Budget $500–1,500 per state.

---

## 11. Risks and Kill Criteria

| Risk | Severity | Mitigation |

|---|---|---|

| Content volume defeats you | **Highest** | Phase it. Ship 3 states well rather than 50 badly. A thin bank is worse than no bank — see the electrician apps. |

| Content accuracy failure | **Highest** | Citation chain + lint CI + human QA. One viral "wrong answers" review is fatal in this category. |

| Statutes change annually | High | `last_verified` on every item. Annual re-verification pass budgeted as ongoing cost, not a project. |

| You've never sat this exam | Medium | Citation discipline makes correctness verifiable rather than a judgement call. Paid licensed reviewers close the gap. |

| Payment rails reject you | Medium | Phase 0 gate. Do not build before this is answered. |

| Incumbent adds state content | Medium | They've had a decade and haven't. Their subscription model also can't match a $59 lifetime price without cannibalising themselves. Your speed advantage is real but not permanent. |

| Employer IP conflict | Low here | Exam prep is not CRO or analytics. Still read the contract. |

**Kill criteria — walk away if:**

- Phase 0 shows you cannot receive payouts from Ghana through any route

- Florida + Texas + California combined produce under 150 sales in the first 90 days after launch with the landing pages live

- Your QA reviewers reject more than 20% of generated items after pipeline tuning (means the content approach doesn't work)

---

## 12. Verification Checklist — do these before writing code

- [ ] Confirm Google Play and Apple developer payouts to a Ghanaian bank; identify required tax forms

- [ ] Apply to Paddle and Lemon Squeezy as Forsare Ventures Ltd; note approval requirements

- [ ] Build the 51-row state map from commission sites and candidate bulletins only

- [ ] Download the current Pearson VUE and PSI content outlines for your first three states

- [ ] Confirm Florida is still 45/55 national/state at 75% pass; confirm Texas and California formats

- [ ] Verify current candidate volumes against ARELLO or state commission annual reports

- [ ] Prototype background audio playback with speed control in your chosen client stack

- [ ] Read your Heatmap employment agreement on IP assignment and outside work

- [ ] Confirm Apple's current Family Sharing opt-out for non-consumable IAP

- [ ] Draft the trademark disclaimer with the incumbents' wording as a reference point

---

## Appendix A — Source URLs

- Pearson VUE national/general salesperson and broker outlines: `pearsonvue.com/content/dam/VUE/vue/en/documents/publications/099913.pdf`

- Pearson VUE Pennsylvania state content outlines: `pearsonvue.com/content/dam/VUE/vue/en/documents/publications/093901.pdf`

- Per-state outlines: search each state's page on the vendor site; do not rely on aggregators

- Florida statutes Chapter 475: `leg.state.fl.us`

- Texas Occupations Code Chapter 1101 and TREC rules: `trec.texas.gov`

- California DRE: `dre.ca.gov`

- ARELLO (licensing law officials, for candidate volume data): `arello.org`

## Appendix B — Review-evidence index

All quotes in §1 and §4 are verbatim from App Store reviews pulled September 2026 across Aceable Real Estate (243 recent reviews, 32% at 1–3 stars, lifetime rating 4.91), Dearborn Real Estate Exam Prep (261 recent, 34% low, 4.78) and Real Estate Exam For Dummies (188 recent, 23% low, 4.77). Raw corpus is reproducible with `nichescan.py`.

The gap between displayed lifetime rating and recent low-star share is the core market signal. Do not trust store ratings.





NOTE: forget about anything that says start with 3 states or something. we are going full. i dont care how long it take to get every 1000s of questions for every state. we are doing everything