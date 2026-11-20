import type { SmsDate } from "./types";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Regex fragment matching any supported date token (for use inside bank parsers). */
export const DATE = String.raw`(\d{1,2}[-/ ]?(?:[A-Za-z]{3}|\d{1,2})[-/ ]?(?:\d{4}|\d{2}))`;

const NAMED = /\b(\d{1,2})[- ]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[- ]?(\d{4}|\d{2})\b/i;
const NUMERIC = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})\b/;

function valid(year: number, month: number, day: number): SmsDate | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * Parse a single date token: 20-Nov-26, 20Nov26, 20 Nov 2026, 20-11-26,
 * 20-11-2026, 20/11/2026. Day-first, as Indian banks print it.
 */
export function parseSmsDate(token: string): SmsDate | null {
  const named = NAMED.exec(token);
  if (named) {
    return valid(fullYear(named[3]), MONTHS.indexOf(named[2].toLowerCase()) + 1, Number(named[1]));
  }
  const numeric = NUMERIC.exec(token);
  if (numeric) {
    return valid(fullYear(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  }
  return null;
}

/** First valid date anywhere in the SMS, or null. */
export function findSmsDate(sms: string): SmsDate | null {
  for (const re of [new RegExp(NAMED.source, "gi"), new RegExp(NUMERIC.source, "g")]) {
    for (const m of sms.matchAll(re)) {
      const d = parseSmsDate(m[0]);
      if (d) return d;
    }
  }
  return null;
}
