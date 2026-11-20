import { AMT, CUR } from "../amount";
import { DATE } from "../date";
import type { SmsParser } from "./types";
import { build, firstMatch } from "./util";

/** Kotak Mahindra Bank savings (representative formats; confirm with real SMS). */
const SENT = new RegExp(String.raw`Sent ${CUR}${AMT} from Kotak Bank AC X(\d+) to (\S+?) on ${DATE}`, "i");
const RECEIVED = new RegExp(
  String.raw`Received ${CUR}${AMT} in your Kotak Bank AC X(\d+) from (\S+?) on ${DATE}`,
  "i",
);

export const kotakParser: SmsParser = {
  source: "KOTAK",
  matches: (sms) => /\bKotak Bank AC\b/i.test(sms) && !/Credit Card/i.test(sms),
  parse: (sms) =>
    firstMatch(sms, [
      [
        SENT,
        (m) => build({ source: "KOTAK", kind: "account_debit", direction: "OUT", amount: m[1], accountDigits: m[2], counterparty: m[3], date: m[4] }),
      ],
      [
        RECEIVED,
        (m) => build({ source: "KOTAK", kind: "account_credit", direction: "IN", amount: m[1], accountDigits: m[2], counterparty: m[3], date: m[4] }),
      ],
    ]),
};
