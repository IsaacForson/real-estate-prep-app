/**
 * What the server has said about each bank's published count (`issue-batch.availability`, V2
 * "never an empty screen"). A bank known to hold 0 items is the only case the UI may call empty;
 * before the first response the count is unknown, not zero.
 */
import type { BankAvailability } from "~~/lib/study/itemSource";

export function useContentAvailability() {
  const counts = useState<Record<string, number>>("content.availability", () => ({}));
  const fallbacks = useState<Record<string, string | null>>("content.availability.fallback", () => ({}));

  function note(a: BankAvailability): void {
    if (counts.value[a.bank] === a.items_available && fallbacks.value[a.bank] === a.fallback_bank) return;
    counts.value = { ...counts.value, [a.bank]: a.items_available };
    fallbacks.value = { ...fallbacks.value, [a.bank]: a.fallback_bank };
  }
  /** Published items in a bank, or null when the server has not said yet. */
  function countFor(bank: string | null | undefined): number | null {
    if (!bank) return null;
    const n = counts.value[bank];
    return typeof n === "number" ? n : null;
  }
  /** True only when the server confirmed the bank has nothing published. */
  function isEmpty(bank: string | null | undefined): boolean {
    return countFor(bank) === 0;
  }
  function fallbackFor(bank: string | null | undefined): string | null {
    return bank ? fallbacks.value[bank] ?? null : null;
  }

  return { counts, note, countFor, isEmpty, fallbackFor };
}
