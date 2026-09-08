/**
 * Product rules as numbers. Every constant cites the SPEC section it implements.
 * The SQL side mirrors the device numbers in migrations/0004_devices_sessions.sql — keep in sync.
 */

// SPEC §5.3 device registry
export const MAX_ACTIVE_DEVICES = 3;
export const DEVICE_COOLDOWN_DAYS = 7;

// SPEC §5.4 session batches: 50–200 items, signed, short ttl
export const BATCH_MIN = 50;
export const BATCH_MAX = 200;
export const BATCH_DEFAULT = 100;
export const BATCH_TTL_SECONDS_DEFAULT = 6 * 60 * 60;

// SPEC §6 free tier: 40 questions, one state, 1 short mock
export const FREE_TIER_ITEMS = 40;
export const FREE_TIER_MOCKS = 1;
export const FREE_TIER_MOCK_FORM = "short";

// SPEC §5.4 "rate-limit item delivery to a plausible human ceiling per hour".
// a fast candidate answers ~60–90 fresh items an hour plus quick reviews; 300 leaves headroom
// for someone who pre-fetches a couple of sessions before going offline (F7).
export const ITEMS_PER_HOUR = 300;
export const BATCHES_PER_HOUR = 8;
export const SYNCS_PER_HOUR = 120;
export const DEVICE_REGISTRATIONS_PER_HOUR = 10;

// SPEC §5.3 anomaly thresholds (flag when strictly greater than)
export const ANOMALY_DISTINCT_DEVICES_30D = 3;
export const ANOMALY_DISTINCT_REGIONS_24H = 3;
// "answer volume exceeding a plausible human ceiling": 4 answers a minute for a full hour.
export const ANOMALY_ANSWERS_PER_HOUR = 240;

// SPEC §5.4 canary items
export const CANARIES_PER_ACCOUNT = 3;
export const CANARIES_PER_BATCH = 1;
export const CANARY_MIN_BATCH_SIZE = 20;

export const RATE_WINDOW_SECONDS = 3600;
