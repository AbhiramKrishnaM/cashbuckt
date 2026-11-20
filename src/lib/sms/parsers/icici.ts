import { AMT, CUR } from "../amount";
import { DATE } from "../date";
import type { SmsParser } from "./types";
import { build, firstMatch } from "./util";

/**
 * ICICI Bank savings account.
 * Confirmed: "ICICI Bank Acct XX123 debited for Rs 370.00 on 20-Nov-26; MOMO WANG credited. UPI:..."
 * The trailing "<party> credited" names the payee; the owner's account is the one debited.
 */
const DEBIT_TO_PARTY = new RegExp(
  String.raw`ICICI Bank Acc(?:oun)?t XX(\d+) (?:is )?debited (?:for|with) ${CUR}${AMT} on ${DATE}; (.+?) credited\.`,
  "i",
);
const DEBIT_TOWARDS = new RegExp(
  String.raw`ICICI Bank Acc(?:oun)?t XX(\d+) (?:is )?debited (?:for|with) ${CUR}${AMT} on ${DATE} towards (.+?)\.(?: |$)`,
  "i",
);
const CREDIT = new RegExp(
  String.raw`ICICI Bank Acc(?:oun)?t XX(\d+) (?:is )?credited(?: with|:)? ?${CUR}${AMT} on ${DATE}\.?(?: Info:? ?(.+?)\.(?: |$))?`,
  "i",
);

/** "NEFT-CITIN26331XXXXXX-ACME TECH PVT LTD" -> "ACME TECH PVT LTD". */
function infoParty(info: string | undefined): string | null {
  if (!info) return null;
  const parts = info.split("-").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

export const iciciParser: SmsParser = {
  source: "ICICI",
  matches: (sms) => /ICICI Bank Acc(?:oun)?t XX\d+/i.test(sms) && !/Credit Card/i.test(sms),
  parse: (sms) =>
    firstMatch(sms, [
      [
        DEBIT_TO_PARTY,
        (m) => build({ source: "ICICI", kind: "account_debit", direction: "OUT", accountDigits: m[1], amount: m[2], date: m[3], counterparty: m[4] }),
      ],
      [
        DEBIT_TOWARDS,
        (m) => build({ source: "ICICI", kind: "account_debit", direction: "OUT", accountDigits: m[1], amount: m[2], date: m[3], counterparty: m[4] }),
      ],
      [
        CREDIT,
        (m) => build({ source: "ICICI", kind: "account_credit", direction: "IN", accountDigits: m[1], amount: m[2], date: m[3], counterparty: infoParty(m[4]) }),
      ],
    ]),
};
