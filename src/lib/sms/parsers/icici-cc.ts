import { AMT, CUR } from "../amount";
import { DATE } from "../date";
import type { SmsParser } from "./types";
import { build, firstMatch } from "./util";

/** ICICI Bank credit card (representative formats; confirm with real SMS). */
const SPEND = new RegExp(
  String.raw`${CUR}${AMT} spent (?:using|on) ICICI Bank (?:Credit )?Card XX(\d+) on ${DATE} (?:on|at) (.+?)\. Avl`,
  "i",
);
const PAYMENT = new RegExp(
  String.raw`Payment of ${CUR}${AMT} has been received (?:on|towards) your ICICI Bank Credit Card(?: Account)? XX(\d+)(?: on ${DATE})?`,
  "i",
);

export const iciciCcParser: SmsParser = {
  source: "ICICI_CC",
  matches: (sms) => /ICICI Bank (?:Credit )?Card(?: Account)? XX\d+/i.test(sms),
  parse: (sms) =>
    firstMatch(sms, [
      [
        SPEND,
        (m) => build({ source: "ICICI_CC", kind: "card_spend", direction: "OUT", amount: m[1], accountDigits: m[2], date: m[3], counterparty: m[4] }),
      ],
      [
        PAYMENT,
        (m) => build({ source: "ICICI_CC", kind: "card_payment_received", direction: "IN", amount: m[1], accountDigits: m[2], date: m[3] }),
      ],
    ]),
};
