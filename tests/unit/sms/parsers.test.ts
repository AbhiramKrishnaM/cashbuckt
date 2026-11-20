import { describe, expect, it } from "vitest";
import { parseSms } from "@/lib/sms/parsers";
import type { SmsDate } from "@/lib/sms/types";
import { parseGeneric } from "@/lib/sms/parsers/generic";
import { TXN_FIXTURES, UNRECOGNIZED_SMS } from "../../fixtures/sms";

const iso = (d: SmsDate | null) =>
  d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null;

describe("bank parsers (table-driven over fixtures)", () => {
  it.each(TXN_FIXTURES.map((f) => [f.name, f] as const))("%s", (_name, f) => {
    const p = parseSms(f.sms);
    expect(p, "parser returned null").not.toBeNull();
    expect({
      source: p!.source,
      direction: p!.direction,
      amount: p!.amount,
      counterparty: p!.counterparty,
      accountRef: p!.accountRef,
      date: iso(p!.date),
    }).toEqual({
      source: f.expected.source,
      direction: f.expected.direction,
      amount: f.expected.amount,
      counterparty: f.expected.counterparty,
      accountRef: f.expected.accountRef,
      date: f.expected.date,
    });
  });
});

describe("bank parser ownership", () => {
  it("a bank-owned SMS that does not fully match stays unrecognized (no generic fallthrough)", () => {
    // ICICI owns it (matches "ICICI Bank Acct XX..."), but the wording is unknown.
    expect(parseSms("ICICI Bank Acct XX123 has been debited Rs 50 at somewhere weird")).toBeNull();
  });
});

describe("generic fallback", () => {
  it("rejects the unknown 'processed for A/c' SMS", () => {
    expect(parseSms(UNRECOGNIZED_SMS)).toBeNull();
  });

  it("rejects SMS with both debited and credited and no bank match", () => {
    expect(parseGeneric("Rs 300.00 debited from A/c XX77 and credited to beneficiary XYZ.")).toBeNull();
  });

  it("parses a simple unambiguous debit", () => {
    expect(parseSms("Rs 100 debited from your A/c XX99")).toEqual({
      source: "UNKNOWN",
      kind: "account_debit",
      direction: "OUT",
      amount: "100.00",
      counterparty: null,
      accountRef: "UNKNOWN XX99",
      date: null,
    });
  });

  it("needs an account or card mention", () => {
    expect(parseGeneric("You received Rs 100 cashback points")).toBeNull();
  });
});
