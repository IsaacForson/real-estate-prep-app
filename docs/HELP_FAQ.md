# Help Center FAQ

Hand-written source for the in-app Help Center. `pnpm --filter @rep/app help:kb` turns every
`## ` section below into one article in `apps/app/public/content/help.json` (with the product rules
from SPEC.md, the QA docs, the methodology page and the legal pages). Keep each answer under
250 words, factual, and in the product's voice. The two lines right under a heading
(`category:` and `keywords:`) are metadata, not body text.

## Signing in with an email code
category: Account & devices
keywords: sign in, login, code, email, password, 6-digit, magic link, can't sign in

There is no password. Enter your email and we send a 6-digit code; type it in and you are signed in. The code expires after a few minutes, so request a new one if it has been a while. Check your spam folder if nothing arrives, and make sure the address is spelled exactly as you registered it.

Your session stays signed in on that device so studying is never interrupted. Your account is used on one device at a time — signing in somewhere else moves it there; see "Using your account on more than one device".

If the email contains a sign-in link instead of a code, tapping it also works on the web. Codes are single use and only work for the address they were sent to; we never ask for a code over the phone or in chat.

## Buying Complete and restoring a purchase
category: Purchases
keywords: buy, purchase, restore, App Store, Google Play, receipt, unlock, Complete, RevenueCat, web checkout

Complete is one payment: every state portion, both national banks, all mocks, audio and every future update. Buy it in the app through the App Store or Google Play, or on the web through our checkout partner, and it is tied to your account (sign in first so it follows you to your other devices).

Bought before and not seeing it? Go to Pricing and tap "Restore purchases" while signed in with the same store account you bought with. Store purchases are recognised by the store account, then attached to the signed-in app account. If you bought on the web, sign in with the same email you used at checkout.

If a purchase still does not show, contact support from the Account screen with the store receipt or order email and we will attach it manually.

## Refunds and the pass guarantee
category: Purchases
keywords: refund, guarantee, pass guarantee, failed, money back, 90 days, cancel

The pass guarantee is an optional add-on to Complete. If you sit the exam within 90 days of purchase and fail, send us proof of the failed attempt (the score report from the testing vendor) and we refund both payments in full. The guarantee requires that you completed at least 5 full-length mocks before the exam, because doing the mocks is what actually predicts passing.

Refunds without the guarantee follow the store's policy: purchases made through the App Store or Google Play are refunded by Apple or Google under their rules, and web purchases are handled by our checkout partner. Contact support first; we can usually resolve it faster than a store dispute. Because Complete is a one-time payment there is nothing to cancel and no renewal to stop.

## Using your account on more than one device
category: Account & devices
keywords: devices, two devices, another device, new phone, tablet, laptop, signed out, switch device

Your account works on one device at a time, and it is always the last one you signed in on. Sign in on your phone and your laptop is signed out; sign back in on the laptop and it comes straight back. There is no limit on how often you switch and no waiting period, so moving between a phone, a tablet and a laptop is fine — you just cannot study on two of them at the same moment.

If a device you no longer use is holding the account, you can sign it out from the Account screen, but you rarely need to: simply signing in where you are takes the account back.

Your progress lives in your account, not on the device. Clearing storage, reinstalling or signing in on a new phone brings back exactly the same history, boxes and readiness score once you sign in.

The readiness score assumes one person is answering. Sharing an account mixes two people's answers into one history and makes the score, the study plan and the coverage meter wrong for both.

## Studying offline
category: Studying
keywords: offline, no internet, airplane, sync, connection, progress lost

The study path works without a connection. The app keeps everything you have already seen plus a look-ahead window of upcoming questions on the device, so practice, review and audio keep working on a plane or underground. Answers you give offline are queued and synced to your account the next time you are online, and nothing is lost if the app is closed mid-question; it resumes on the same question.

Two things need a connection: signing in (the code arrives by email) and starting a brand-new mock form or a state you have not opened before, because the server issues those questions. Open them once while online and they are cached.

## Audio narration
category: Studying
keywords: audio, narration, read aloud, speed, background, lock screen, hands-free, voice

Every question, its options and the explanation can be read aloud. Speed runs from 0.75x to 2.5x, pause keeps your place, and playback continues in the background and from the lock screen with the usual media controls. Auto-advance mode reads the question, waits, reveals the answer and moves on, for hands-free study while driving or at the gym.

Narration is pre-recorded for each question so it sounds the same on every device; where a recording is not yet available the app uses the device voice as a fallback. Audio files are cached after first play, so they also work offline.

## Why every answer has a citation
category: How questions are verified
keywords: citation, statute, source, law, why, correct, wrong answer, evidence

Under each answer you will see the exact section of law or rule it rests on, with the relevant sentence quoted. We write every question ourselves from the state licensing statute, the commission's administrative rules, or the federal law (Fair Housing Act, RESPA, TILA, ECOA, CERCLA), and a question cannot be published unless the quoted text is found verbatim in that source and an independent check confirms it supports the keyed answer.

That chain is why we can say an answer is right without asking you to trust us: tap the citation and read the law. If you think a question is wrong, use "Report a problem" on the question; every report is read and the citation is what we check first.

## Which states are covered right now
category: Coverage
keywords: states, coverage, my state, when, available, in production, national, Pearson VUE, PSI

Both national banks (Pearson VUE and PSI weightings) and all 50 states plus DC are in scope, and Complete includes every state, present and future. Each state page shows its honest status: the number of verified questions available today and whether the state portion is complete, in production or still being built. The app picks the national bank that matches your state's exam vendor automatically.

If your state's portion is still in production you can already study the national portion and you will see new state questions appear as they are verified, with no store update needed. Content refreshes in the background about once a day.

## Contacting support
category: Support
keywords: contact, support, help, ticket, email, report a problem, bug

Use "Contact us" in the Account screen or in the Help Center. It opens a ticket tied to your account so we can see your purchase and device situation without asking; replies arrive in the app and by email. For a question you think is wrong, use "Report a problem" on that question so the item id travels with the report.

Before writing, try the Help Center search; most answers about sign-in codes, purchases, devices and refunds are here. If a Help Center answer does not cover your case, the "Ask" box sends the question to an assistant that answers only from these articles and flags anything it cannot answer for a human to pick up.
