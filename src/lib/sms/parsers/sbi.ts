import { AMT, CUR } from "../amount";
import { DATE } from "../date";
import type { SmsParser } from "./types";
import { build, firstMatch } from "./util";

/**
 * State Bank of India savings (representative formats; confirm with real SMS).
 * Note SBI UPI debits print a bare amount: "debited by 250.0".
 */
const DEBIT = new RegExp(
  String.raw`A/C X(\d+) debited by (?:${CUR})?${AMT} on date ${DATE} trf to (.+?) Ref ?no`,
  "i",
);
const CREDIT = new RegExp(
  String.raw`A/c X(\d+)[- ]credited by (?:${CUR})?${AMT} on (?:date )?${DATE} transfer from (.+?) Ref ?No`,
  "i",
);

export const sbiParser: SmsParser = {
  source: "SBI",
  matches: (sms) => /(?:-SBI\b|\bSBI User\b|\bState Bank\b)/i.test(sms),
  parse: (sms) =>
    firstMatch(sms, [
      [
        DEBIT,
        (m) => build({ source: "SBI", kind: "account_debit", direction: "OUT", accountDigits: m[1], amount: m[2], date: m[3], counterparty: m[4] }),
      ],
      [
        CREDIT,
        (m) => build({ source: "SBI", kind: "account_credit", direction: "IN", accountDigits: m[1], amount: m[2], date: m[3], counterparty: m[4] }),
      ],
    ]),
};
