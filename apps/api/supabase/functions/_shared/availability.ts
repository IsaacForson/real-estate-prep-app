/**
 * Bank availability ("never an empty screen"). A bank with nothing published is not an error: the
 * client is told how many items exist and which national bank carries the learner meanwhile. Only
 * real, published, non-canary items count — nothing is ever invented to pad a bank.
 */
import type { Db } from "./db.ts";
import { HttpError } from "./response.ts";
import { NATIONAL_BANKS, type NationalBank } from "./mock.ts";

export interface Availability {
  bank: string;
  items_available: number;
  /** the national bank a learner in this state studies while the state bank fills; null for national banks */
  fallback_bank: NationalBank | null;
}

export function isNationalBank(bank: string): bank is NationalBank {
  return (NATIONAL_BANKS as readonly string[]).includes(bank);
}

/** Pure shaping so the response is identical everywhere it appears. */
export function shapeAvailability(bank: string, itemsAvailable: number, nationalBank: NationalBank): Availability {
  return {
    bank,
    items_available: Math.max(0, Math.floor(itemsAvailable)),
    fallback_bank: isNationalBank(bank) ? null : nationalBank,
  };
}

/** Published, non-canary items in a bank. */
export async function itemsAvailable(db: Db, bank: string): Promise<number> {
  const { count, error } = await db
    .from("item_index")
    .select("item_id", { count: "exact", head: true })
    .eq("bank", bank)
    .eq("status", "published")
    .eq("is_canary", false);
  if (error) throw new HttpError(500, "item_index_count_failed", error.message);
  return count ?? 0;
}

/** Body field `national_bank` (optional): which national bank to name as the fallback. */
export function readNationalBank(v: unknown, fallback: NationalBank = "national_pearsonvue"): NationalBank {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "string" || !isNationalBank(v)) throw new HttpError(400, "invalid_national_bank");
  return v;
}
