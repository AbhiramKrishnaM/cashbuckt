import { describe, expect, it } from "vitest";
import { findSmsDate, parseSmsDate } from "@/lib/sms/date";

const NOV_20 = { year: 2026, month: 11, day: 20 };

describe("parseSmsDate", () => {
  it.each(["20-Nov-26", "20Nov26", "20 Nov 2026", "20-11-26", "20-11-2026", "20/11/2026", "20-NOV-2026"])(
    "parses %s",
    (token) => {
      expect(parseSmsDate(token)).toEqual(NOV_20);
    },
  );

  it.each(["31-Feb-26", "30/02/2026", "00-11-26", "20-13-26", "hello"])("rejects %s", (token) => {
    expect(parseSmsDate(token)).toBeNull();
  });
});

describe("findSmsDate", () => {
  it("finds the compact SBI date", () => {
    expect(
      findSmsDate(
        "Dear UPI user A/C X1234 debited by 250.0 on date 20Nov26 trf to SWIGGY Refno 600000000002. If not u? call 1800111109. -SBI",
      ),
    ).toEqual(NOV_20);
  });

  it("ignores phone numbers and references", () => {
    expect(findSmsDate("Call 18002662 for dispute. SMS BLOCK 123 to 9215676766")).toBeNull();
  });

  it("returns null when there is no date", () => {
    expect(findSmsDate("You've spent Rs. 650 at ZOMATO on your OneCard credit card ending 7788.")).toBeNull();
  });
});
