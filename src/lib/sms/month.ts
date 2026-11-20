import type { Channel, SmsDate } from "./types";

/** India has no DST: IST is always UTC+05:30. */
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Calendar date of an instant, in IST. */
export function istDate(instant: Date): SmsDate {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

const dayNumber = (d: SmsDate) => Date.UTC(d.year, d.month - 1, d.day) / DAY_MS;

/** 12:00 IST on the given calendar date. */
function istNoon(d: SmsDate): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day, 12) - IST_OFFSET_MS);
}

/**
 * Transaction time (spec "Transaction time from SMS date"):
 *  - no SMS date, same day as received, or a future date → receive time
 *  - earlier SMS date (late re-send) → 12:00 IST on that date
 */
export function transactionTime(smsDate: SmsDate | null, receivedAt: Date): Date {
  if (!smsDate) return receivedAt;
  const diff = dayNumber(smsDate) - dayNumber(istDate(receivedAt));
  return diff < 0 ? istNoon(smsDate) : receivedAt;
}

export function monthKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Bucket month for a transaction, applying the 25th–31st salary carryover. */
export function bucketMonthKey(txnTime: Date, channel: Channel): string {
  const { year, month, day } = istDate(txnTime);
  if (channel === "SALARY" && day >= 25) {
    return month === 12 ? monthKeyOf(year + 1, 1) : monthKeyOf(year, month + 1);
  }
  return monthKeyOf(year, month);
}

/** "2026-12" -> "December 2026". */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
