export const SAVINGS_SOURCES = ["ICICI", "SBI", "UTKARSH", "KOTAK"] as const;
export const CARD_SOURCES = ["ICICI_CC", "KOTAK_CC", "ONECARD"] as const;

export type SavingsSource = (typeof SAVINGS_SOURCES)[number];
export type CardSource = (typeof CARD_SOURCES)[number];
export type Source = SavingsSource | CardSource | "UNKNOWN";

export type Direction = "IN" | "OUT";

export type Channel =
  | "SALARY"
  | "OTHER_IN"
  | "EMI_AUTOPAY"
  | "UPI"
  | "CARD"
  | "CARD_PAYMENT"
  | "SELF_TRANSFER";

/** Calendar date as printed in the SMS (interpreted in Asia/Kolkata). */
export type SmsDate = { year: number; month: number; day: number };

/**
 * What kind of event the SMS describes, as understood by the bank parser.
 * Classification turns this into a channel.
 */
export type SmsKind =
  | "account_debit"
  | "account_credit"
  | "card_spend"
  | "card_refund"
  | "card_payment_received";

export type ParsedSms = {
  source: Source;
  kind: SmsKind;
  direction: Direction;
  /** Exact decimal string with two places, e.g. "142000.00". */
  amount: string;
  counterparty: string | null;
  /** e.g. "ICICI XX123", "KOTAK_CC XX4402". */
  accountRef: string | null;
  date: SmsDate | null;
};

export type ClassifiedSms = ParsedSms & {
  channel: Channel;
  needsNote: boolean;
};

export function isCardSource(source: Source): source is CardSource {
  return (CARD_SOURCES as readonly string[]).includes(source);
}

export function isSavingsSource(source: Source): source is SavingsSource {
  return (SAVINGS_SOURCES as readonly string[]).includes(source);
}
