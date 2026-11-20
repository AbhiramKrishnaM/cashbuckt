import { AMT, CUR } from "../amount";
import { findSmsDate } from "../date";
import type { SmsParser } from "./types";
import { build } from "./util";

/** OneCard credit card (representative format; confirm with real SMS). */
const SPEND = new RegExp(
  String.raw`spent ${CUR}${AMT} at (.+?) on your OneCard credit card ending (\d+)`,
  "i",
);

export const onecardParser: SmsParser = {
  source: "ONECARD",
  matches: (sms) => /\bOneCard\b/i.test(sms),
  parse: (sms) => {
    const m = SPEND.exec(sms);
    if (!m) return null;
    const parsed = build({
      source: "ONECARD",
      kind: "card_spend",
      direction: "OUT",
      amount: m[1],
      counterparty: m[2],
      accountDigits: m[3],
    });
    return parsed && { ...parsed, date: findSmsDate(sms) };
  },
};
