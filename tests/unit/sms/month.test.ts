import { describe, expect, it } from "vitest";
import { bucketMonthKey, istDate, monthLabel, transactionTime } from "@/lib/sms/month";

/** Build an instant from an IST wall-clock time. */
const ist = (s: string) => new Date(`${s}+05:30`);

describe("IST calendar month", () => {
  it("00:10 IST on Dec 1 (18:40 UTC Nov 30) goes to 2026-12", () => {
    const t = ist("2026-12-01T00:10:00");
    expect(t.toISOString()).toBe("2026-11-30T18:40:00.000Z");
    expect(bucketMonthKey(t, "UPI")).toBe("2026-12");
  });

  it("23:50 IST on Nov 30 goes to 2026-11", () => {
    expect(bucketMonthKey(ist("2026-11-30T23:50:00"), "UPI")).toBe("2026-11");
  });

  it("istDate uses IST, not UTC", () => {
    expect(istDate(new Date("2026-11-30T19:00:00Z"))).toEqual({ year: 2026, month: 12, day: 1 });
  });
});

describe("salary carryover", () => {
  it("salary on Nov 27 goes to 2026-12", () => {
    expect(bucketMonthKey(ist("2026-11-27T10:00:00"), "SALARY")).toBe("2026-12");
  });

  it("salary on the 25th is carried over", () => {
    expect(bucketMonthKey(ist("2026-11-25T09:00:00"), "SALARY")).toBe("2026-12");
  });

  it("salary on the 24th is not", () => {
    expect(bucketMonthKey(ist("2026-11-24T09:00:00"), "SALARY")).toBe("2026-11");
  });

  it("salary on Dec 26 rolls into 2027-01", () => {
    expect(bucketMonthKey(ist("2026-12-26T10:00:00"), "SALARY")).toBe("2027-01");
  });

  it("salary on Dec 3 stays in 2026-12", () => {
    expect(bucketMonthKey(ist("2026-12-03T10:00:00"), "SALARY")).toBe("2026-12");
  });

  it("OTHER_IN on Nov 27 is not carried over", () => {
    expect(bucketMonthKey(ist("2026-11-27T10:00:00"), "OTHER_IN")).toBe("2026-11");
  });
});

describe("transaction time from SMS date", () => {
  const received = ist("2026-12-02T09:15:00");

  it("a Nov 30 SMS first received Dec 2 is timed 12:00 IST Nov 30 → 2026-11", () => {
    const t = transactionTime({ year: 2026, month: 11, day: 30 }, received);
    expect(t.toISOString()).toBe(ist("2026-11-30T12:00:00").toISOString());
    expect(bucketMonthKey(t, "UPI")).toBe("2026-11");
  });

  it("same-day SMS keeps the receive time", () => {
    const now = ist("2026-11-20T21:30:00");
    expect(transactionTime({ year: 2026, month: 11, day: 20 }, now)).toBe(now);
  });

  it("an implausible future date (Dec 30 received Nov 20) uses the receive time", () => {
    const now = ist("2026-11-20T10:00:00");
    const t = transactionTime({ year: 2026, month: 12, day: 30 }, now);
    expect(t).toBe(now);
    expect(bucketMonthKey(t, "UPI")).toBe("2026-11");
  });

  it("no SMS date uses the receive time", () => {
    expect(transactionTime(null, received)).toBe(received);
  });
});

describe("monthLabel", () => {
  it.each([
    ["2026-12", "December 2026"],
    ["2027-01", "January 2027"],
  ])("%s -> %s", (key, label) => {
    expect(monthLabel(key)).toBe(label);
  });
});
