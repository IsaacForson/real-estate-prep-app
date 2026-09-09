import { assert, assertEquals } from "@std/assert";
import { apportion, mockFormSpec, scoreMock, validateMockAnswer } from "../_shared/mock.ts";
import { FREE_TIER_MOCK_ITEMS, MOCK_FULL_MINUTES, MOCK_SHORT_MINUTES } from "../_shared/limits.ts";
import { applyAnswer, EMPTY_SRS, isLeech } from "../_shared/srs.ts";
import { buildHelpMessages, extractSources, parseKbEntry } from "../_shared/groq.ts";
import { validateEvent } from "../_shared/events.ts";

Deno.test("mockFormSpec: short = free-tier form, anything else is full length", () => {
  const short = mockFormSpec("short", "FL");
  assertEquals(short.size, FREE_TIER_MOCK_ITEMS);
  assertEquals(short.time_limit_ms, MOCK_SHORT_MINUTES * 60_000);
  assertEquals(short.portions.map((p) => p.bank), ["national_pearsonvue", "state_FL"]);
  const full = mockFormSpec("A", "TX", "national_psi");
  assertEquals(full.size, 120);
  assertEquals(full.time_limit_ms, MOCK_FULL_MINUTES * 60_000);
  assertEquals(full.portions[0]!.bank, "national_psi");
  assertEquals(full.portions[1]!.bank, "state_TX");
});

Deno.test("apportion: largest remainder, sums to total", () => {
  assertEquals(apportion([12, 8], 20), [12, 8]);
  assertEquals(apportion([12, 8], 5), [3, 2]);
  assertEquals(apportion([80, 40], 7), [5, 2]);
  assertEquals(apportion([0, 0], 5), [0, 0]);
});

Deno.test("scoreMock: unanswered = wrong, first answer wins, unknown ids ignored, per-portion scores", () => {
  const items = [
    { public_id: "a", key: "A" as const, portion: "national" as const },
    { public_id: "b", key: "B" as const, portion: "national" as const },
    { public_id: "c", key: "C" as const, portion: "state" as const },
    { public_id: "d", key: "D" as const, portion: "state" as const },
  ];
  const r = scoreMock(items, [
    { public_id: "a", choice: "A", ms: 1000 },
    { public_id: "a", choice: "B" }, // duplicate, ignored
    { public_id: "b", choice: "C" },
    { public_id: "c", choice: "C" },
    { public_id: "zzz", choice: "A" }, // not in the form
  ]);
  assertEquals(r.total, 4);
  assertEquals(r.answered, 3);
  assertEquals(r.correct, 2);
  assertEquals(r.score, 0.5);
  assertEquals(r.passed, false);
  assertEquals(r.portions, [
    { portion: "national", total: 2, correct: 1, score: 0.5 },
    { portion: "state", total: 2, correct: 1, score: 0.5 },
  ]);
  assertEquals(r.items[3], { public_id: "d", choice: null, key: "D", correct: false, ms: null });
  const perfect = scoreMock(items, items.map((i) => ({ public_id: i.public_id, choice: i.key })));
  assertEquals(perfect.score, 1);
  assert(perfect.passed);
  assertEquals(scoreMock([], []).score, 0);
});

Deno.test("validateMockAnswer", () => {
  assertEquals(validateMockAnswer({ public_id: "x", choice: "B", ms: 12 }), { public_id: "x", choice: "B", ms: 12 });
  assertEquals(validateMockAnswer({ public_id: "x" }), { public_id: "x", choice: null, ms: null });
  assertEquals(validateMockAnswer({ public_id: "x", choice: "E" }), null);
  assertEquals(validateMockAnswer({ public_id: "", choice: "A" }), null);
  assertEquals(validateMockAnswer({ public_id: "x", choice: "A", ms: -1 }), null);
});

Deno.test("server srs mirror follows the F10 boxes (red → yellow → green, wrong → red)", () => {
  const t0 = Date.parse("2026-09-09T12:00:00Z");
  const s1 = applyAnswer(null, true, t0);
  assertEquals(s1.box, "yellow");
  assertEquals(s1.due_at, new Date(t0 + 2 * 86_400_000).toISOString());
  const s2 = applyAnswer(s1, true, t0 + 1);
  assertEquals(s2.box, "green");
  assertEquals(s2.streak, 2);
  const s3 = applyAnswer(s2, false, t0 + 2);
  assertEquals(s3.box, "red");
  assertEquals(s3.streak, 0);
  assertEquals(s3.due_at, new Date(t0 + 2).toISOString());
  assertEquals(s3.history.length, 3);
  let s = EMPTY_SRS;
  for (let i = 0; i < 4; i++) s = applyAnswer(s, false, t0 + i);
  assert(isLeech(s));
});

Deno.test("help-ai prompt building: numbered sources, json or plain entries, cited sources extracted", () => {
  assertEquals(
    parseKbEntry(
      JSON.stringify({ title: "Refunds", url: "https://x.test/refunds", body: "Refunds within 14 days." }),
      0,
    ),
    {
      title: "Refunds",
      url: "https://x.test/refunds",
      body: "Refunds within 14 days.",
    },
  );
  assertEquals(parseKbEntry("# Devices\nYou can use 3 devices.", 1)?.title, "Devices");
  assertEquals(parseKbEntry("", 2), null);
  assertEquals(parseKbEntry(42, 3), null);
  const { messages, sources } = buildHelpMessages("how many devices?", [
    "# Devices\nYou can use 3 devices.",
    '{"title":"Pricing","body":"$59 once."}',
  ]);
  assertEquals(messages.length, 2);
  assertEquals(messages[0]!.role, "system");
  assert(messages[1]!.content.includes("[1] Devices"));
  assert(messages[1]!.content.includes("[2] Pricing"));
  assert(messages[1]!.content.endsWith("QUESTION: how many devices?"));
  assertEquals(extractSources("You can use three devices [1].", sources), ["Devices"]);
  assertEquals(extractSources("No idea.", sources), ["Devices", "Pricing"]); // nothing cited → all
  assertEquals(extractSources("see [9]", sources), ["Devices", "Pricing"]); // out of range ignored
});

Deno.test("validateEvent: known kinds only, props object, clock clamped", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  assertEquals(validateEvent({ kind: "app_open" }, now), { kind: "app_open", props: {}, at: now.toISOString() });
  assertEquals(validateEvent({ kind: "made_up" }, now), null);
  assertEquals(validateEvent({ kind: "answer", props: [] }, now), null);
  assertEquals(validateEvent({ kind: "answer", at: "garbage" }, now), null);
  const future = validateEvent({ kind: "sign_in", at: "2030-01-01T00:00:00Z" }, now);
  assertEquals(future?.at, new Date(now.getTime() + 5 * 60_000).toISOString());
  const old = validateEvent({ kind: "sign_in", at: "2020-01-01T00:00:00Z" }, now);
  assertEquals(old?.at, new Date(now.getTime() - 30 * 86_400_000).toISOString());
});
