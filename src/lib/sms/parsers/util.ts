import { toAmount } from "../amount";
import { parseSmsDate } from "../date";
import type { Direction, ParsedSms, SmsKind, Source } from "../types";

/** Build a ParsedSms from regex captures; null if the amount is invalid. */
export function build(fields: {
  source: Source;
  kind: SmsKind;
  direction: Direction;
  amount: string | undefined;
  counterparty?: string | null;
  accountDigits?: string | null;
  date?: string | null;
}): ParsedSms | null {
  const amount = fields.amount ? toAmount(fields.amount) : null;
  if (!amount) return null;
  const counterparty = fields.counterparty?.trim().replace(/[.,;]+$/, "") || null;
  return {
    source: fields.source,
    kind: fields.kind,
    direction: fields.direction,
    amount,
    counterparty,
    accountRef: fields.accountDigits ? `${fields.source} XX${fields.accountDigits}` : null,
    date: fields.date ? parseSmsDate(fields.date) : null,
  };
}

/** Try each [regex, builder] pair in order; first non-null result wins. */
export function firstMatch(
  sms: string,
  rules: [RegExp, (m: RegExpExecArray) => ParsedSms | null][],
): ParsedSms | null {
  for (const [re, toParsed] of rules) {
    const m = re.exec(sms);
    if (m) {
      const parsed = toParsed(m);
      if (parsed) return parsed;
    }
  }
  return null;
}
