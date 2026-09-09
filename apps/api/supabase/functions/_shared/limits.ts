/**
 * Product rules as numbers. Every constant cites the SPEC section it implements.
 * The SQL side mirrors the device numbers in migrations/0004_devices_sessions.sql — keep in sync.
 */

// SPEC §5.3 device registry: how many devices may hold a live session at once. This is the *default*
// only — since 0016 the live value is a row in app_settings that an admin edits from the console, so
// read it with maxActiveDevices() in _shared/settings.ts rather than importing this. At 1 the newest
// sign-in takes the account over (0015); above 1 older devices keep working until the ceiling is hit.
export const DEFAULT_MAX_ACTIVE_DEVICES = 1;
export const MAX_ACTIVE_DEVICES_CEILING = 10;

// SPEC §5.4 session batches: 50–200 items, signed, short ttl
export const BATCH_MIN = 50;
export const BATCH_MAX = 200;
export const BATCH_DEFAULT = 100;
export const BATCH_TTL_SECONDS_DEFAULT = 6 * 60 * 60;

// Free tier: 20 questions, one state, 1 short mock
export const FREE_TIER_ITEMS = 20;
export const FREE_TIER_MOCKS = 1;
export const FREE_TIER_MOCK_FORM = "short";
export const FREE_TIER_MOCK_ITEMS = 20; // the one free mock is a short form (mirrors apps/app/lib/study/freeTier.ts)

// V2_PLAN §1 device tracking: a device used by this many accounts in 30 days loses its free tier.
export const DEVICE_ACCOUNTS_30D_LIMIT = 3;

// F11 mock forms (server-built in mock-start). national/state split mirrors the typical vendor exam
// (80 national / 150 min + 40 state / 90 min); "short" is the free-tier form.
export const MOCK_SHORT_NATIONAL = 12;
export const MOCK_SHORT_STATE = 8;
export const MOCK_SHORT_MINUTES = 30;
export const MOCK_FULL_NATIONAL = 80;
export const MOCK_FULL_STATE = 40;
export const MOCK_FULL_MINUTES = 240;
export const MOCK_PASS_SCORE = 0.75;

// per-hour ceilings for the v2 functions
export const EVENTS_PER_HOUR = 1200;
export const HELP_AI_PER_HOUR = 30;
export const SUPPORT_MESSAGES_PER_HOUR = 30;
export const COUPON_ATTEMPTS_PER_HOUR = 10;
export const MOCK_STARTS_PER_HOUR = 6;

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
