import { assertEquals } from "@std/assert";
import { answersInWindow, detectAnomalies, distinctRegions } from "../_shared/anomaly.ts";

const now = new Date("2026-09-08T12:00:00Z");

Deno.test("distinctRegions ignores unknown and events outside 24h", () => {
  const n = distinctRegions(
    [
      { region_key: "US-FL", created_at: "2026-09-08T11:00:00Z" },
      { region_key: "US-FL", created_at: "2026-09-08T10:00:00Z" },
      { region_key: "GH", created_at: "2026-09-08T09:00:00Z" },
      { region_key: "unknown", created_at: "2026-09-08T09:30:00Z" },
      { region_key: "US-TX", created_at: "2026-09-07T11:00:00Z" }, // 25h ago
    ],
    now,
  );
  assertEquals(n, 2);
});

Deno.test("answersInWindow sums applied deltas inside the trailing hour", () => {
  const n = answersInWindow(
    [
      { attempts_delta: 3, last_answered_at: "2026-09-08T11:30:00Z" },
      { attempts_delta: 2, last_answered_at: "2026-09-08T10:30:00Z" }, // too old
      { attempts_delta: 0, last_answered_at: "2026-09-08T11:59:00Z" }, // stale row, no delta
      { attempts_delta: 4, last_answered_at: null },
      { attempts_delta: 1, last_answered_at: "2026-09-08T12:03:00Z" }, // slight future skew counts
    ],
    now,
  );
  assertEquals(n, 4);
});

Deno.test("detectAnomalies uses strictly-greater thresholds from SPEC 5.3", () => {
  assertEquals(detectAnomalies({ distinctFingerprints30d: 3, distinctRegions24h: 3, answersLastHour: 240 }), []);
  const f = detectAnomalies({ distinctFingerprints30d: 4, distinctRegions24h: 4, answersLastHour: 241 });
  assertEquals(f.map((x) => x.kind), ["devices_30d", "geo_24h", "answer_velocity"]);
  assertEquals(f[0]?.details, { distinct_fingerprints: 4, limit: 3 });
});

Deno.test("detectAnomalies honours custom limits", () => {
  const f = detectAnomalies(
    { distinctFingerprints30d: 2, distinctRegions24h: 0, answersLastHour: 50 },
    { devices30d: 1, regions24h: 3, answersPerHour: 40 },
  );
  assertEquals(f.map((x) => x.kind), ["devices_30d", "answer_velocity"]);
});
