import { AMT, CUR } from "../amount";
import { DATE } from "../date";
import type { SmsParser } from "./types";
import { build, firstMatch } from "./util";

/** Kotak credit card (representative formats; confirm with real SMS). */
const SPEND = new RegExp(String.raw`${CUR}${AMT} spent on Kotak Credit Card XX(\d+) at (.+?) on ${DATE}`, "i");
const REFUND = new RegExp(
  String.raw`Refund of ${CUR}${AMT} credited to your Kotak Credit Card XX(\d+) from (.+?) on ${DATE}`,
  "i",
);
const PAYMENT = new RegExp(
  String.raw`Payment of ${CUR}${AMT} (?:has been )?received (?:on|towards|for) your Kotak Credit Card XX(\d+)(?: on ${DATE})?`,
  "i",
);

export const kotakCcParser: SmsParser = {
  source: "KOTAK_CC",
  matches: (sms) => /\bKotak Credit Card\b/i.test(sms),
  parse: (sms) =>
    firstMatch(sms, [
      [
        SPEND,
        (m) => build({ source: "KOTAK_CC", kind: "card_spend", direction: "OUT", amount: m[1], accountDigits: m[2], counterparty: m[3], date: m[4] }),
      ],
      [
        REFUND,
        (m) => build({ source: "KOTAK_CC", kind: "card_refund", direction: "IN", amount: m[1], accountDigits: m[2], counterparty: m[3], date: m[4] }),
      ],
      [
        PAYMENT,
        (m) => build({ source: "KOTAK_CC", kind: "card_payment_received", direction: "IN", amount: m[1], accountDigits: m[2], date: m[3] }),
      ],
    ]),
};
