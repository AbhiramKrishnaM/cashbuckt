import { describe, expect, it } from "vitest";
import { extractAmount, toAmount, toPaise } from "@/lib/sms/amount";

describe("toAmount", () => {
  it.each([
    ["1,42,000.00", "142000.00"],
    ["142,000.00", "142000.00"],
    ["142000", "142000.00"],
    ["250.0", "250.00"],
    ["650", "650.00"],
    ["0.50", "0.50"],
  ])("%s -> %s", (raw, expected) => {
    expect(toAmount(raw)).toBe(expected);
  });

  it.each(["0", "0.00", "abc", "1.234", ""])("rejects %s", (raw) => {
    expect(toAmount(raw)).toBeNull();
  });
});

describe("toPaise", () => {
  it("converts exactly", () => {
    expect(toPaise("142000.00")).toBe(14200000n);
    expect(toPaise("2.50")).toBe(250n);
  });
});

describe("extractAmount", () => {
  it("takes the credit, not the available balance", () => {
    expect(
      extractAmount(
        "ICICI Bank Account XX123 credited:Rs. 1,42,000.00 on 27-Nov-26. Info NEFT-CITIN26331XXXXXX-ACME TECH PVT LTD. Available Balance is Rs. 1,62,000.00.",
      ),
    ).toBe("142000.00");
  });

  it("reads a bare 'debited by' amount with one decimal", () => {
    expect(
      extractAmount(
        "Dear UPI user A/C X1234 debited by 250.0 on date 20Nov26 trf to SWIGGY Refno 600000000002. If not u? call 1800111109. -SBI",
      ),
    ).toBe("250.00");
  });

  it("reads 'Rs. 650' with a space", () => {
    expect(extractAmount("You've spent Rs. 650 at ZOMATO on your OneCard credit card ending 7788.")).toBe("650.00");
  });

  it("skips the available limit on a card spend", () => {
    expect(
      extractAmount(
        "INR 1,250.00 spent using ICICI Bank Card XX9001 on 20-Nov-26 on AMAZON PAY. Avl Limit: INR 1,00,000.00. If not you, call 1800 2662/SMS BLOCK 9001 to 9215676766.",
      ),
    ).toBe("1250.00");
  });

  it("returns the limit-free amount even when the balance comes first", () => {
    expect(extractAmount("Avl Bal Rs 9,000.00. Rs 100.00 debited from your A/c XX99")).toBe("100.00");
  });
});
