import type { ParsedSms, Source } from "../types";

export type SmsParser = {
  source: Source;
  /** True if this parser owns the SMS (it then decides alone; null = unrecognized). */
  matches(sms: string): boolean;
  parse(sms: string): ParsedSms | null;
};
