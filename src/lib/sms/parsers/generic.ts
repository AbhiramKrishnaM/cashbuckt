import { extractAmount } from "../amount";
import { findSmsDate } from "../date";
import type { ParsedSms } from "../types";

/**
 * Strict fallback for SMS no bank parser owns. Accepts only when the
 * direction is unambiguous: exactly one direction family appears, tied to
 * the owner's account/card, with one usable amount. Anything else stays
 * unrecognized (captured for review) rather than guessed.
 */
const OUT_WORDS = /\b(?:debited|spent|sent|withdrawn|paid)\b/i;
const IN_WORDS = /\b(?:credited|received|deposited)\b/i;
const ACCOUNT = /\b(?:a\/c|ac|acct|account|card)\b/i;
const ACCOUNT_DIGITS = /\b(?:a\/c|ac|acct|account|card)\s*(?:no\.?\s*)?(?:ending\s*)?[X*]+(\d{2,6})\b/i;

export function parseGeneric(sms: string): ParsedSms | null {
  const out = OUT_WORDS.test(sms);
  const inn = IN_WORDS.test(sms);
  if (out === inn) return null; // neither, or both: ambiguous
  if (!ACCOUNT.test(sms)) return null;
  const amount = extractAmount(sms);
  if (!amount) return null;
  const digits = ACCOUNT_DIGITS.exec(sms)?.[1];
  return {
    source: "UNKNOWN",
    kind: out ? "account_debit" : "account_credit",
    direction: out ? "OUT" : "IN",
    amount,
    counterparty: null,
    accountRef: digits ? `UNKNOWN XX${digits}` : null,
    date: findSmsDate(sms),
  };
}
