import { AMT, CUR } from "../amount";
import { DATE } from "../date";
import type { SmsParser } from "./types";
import { build } from "./util";

/** Utkarsh Small Finance Bank savings (representative format; confirm with real SMS). */
const TXN = new RegExp(
  String.raw`${CUR}${AMT} (debited|credited) (?:from|to|in) your Utkarsh(?: SFB| Small Finance Bank)? A/c XX(\d+) on ${DATE}(?: via \w+)? (?:to|from) (\S+?)\.? Ref`,
  "i",
);

export const utkarshParser: SmsParser = {
  source: "UTKARSH",
  matches: (sms) => /\bUtkarsh\b/i.test(sms),
  parse: (sms) => {
    const m = TXN.exec(sms);
    if (!m) return null;
    const out = m[2].toLowerCase() === "debited";
    return build({
      source: "UTKARSH",
      kind: out ? "account_debit" : "account_credit",
      direction: out ? "OUT" : "IN",
      amount: m[1],
      accountDigits: m[3],
      date: m[4],
      counterparty: m[5],
    });
  },
};
