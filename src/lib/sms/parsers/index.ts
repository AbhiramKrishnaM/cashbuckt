import type { ParsedSms } from "../types";
import { parseGeneric } from "./generic";
import { iciciParser } from "./icici";
import { iciciCcParser } from "./icici-cc";
import { kotakParser } from "./kotak";
import { kotakCcParser } from "./kotak-cc";
import { onecardParser } from "./onecard";
import { sbiParser } from "./sbi";
import type { SmsParser } from "./types";
import { utkarshParser } from "./utkarsh";

/**
 * Bank parsers in priority order (cards first: their SMS can mention the
 * bank name too). The first whose `matches()` is true owns the SMS: its
 * parse result is final, so a half-matching bank SMS never falls through
 * to the looser generic parser, which runs only if no bank parser matches.
 */
export const BANK_PARSERS: SmsParser[] = [
  iciciCcParser,
  kotakCcParser,
  onecardParser,
  iciciParser,
  sbiParser,
  utkarshParser,
  kotakParser,
];

export function parseSms(sms: string): ParsedSms | null {
  const owner = BANK_PARSERS.find((p) => p.matches(sms));
  if (owner) return owner.parse(sms);
  return parseGeneric(sms);
}
