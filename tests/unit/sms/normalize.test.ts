import { describe, expect, it } from "vitest";
import { normalizeSms, smsHash } from "@/lib/sms/normalize";

const ICICI =
  "ICICI Bank Acct XX123 debited for Rs 370.00 on 20-Nov-26; MOMO WANG credited. UPI:600000000001. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766";

describe("normalizeSms / smsHash", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeSms("  a \n\t b  ")).toBe("a b");
  });

  it("hashes trailing-newline and double-space variants identically", () => {
    const withNewline = `${ICICI}\n`;
    const doubleSpace = ICICI.replace("20-Nov-26; MOMO", "20-Nov-26;  MOMO");
    expect(smsHash(withNewline)).toBe(smsHash(ICICI));
    expect(smsHash(doubleSpace)).toBe(smsHash(ICICI));
  });

  it("produces 64 lowercase hex chars", () => {
    expect(smsHash(ICICI)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("distinguishes different SMS", () => {
    expect(smsHash(ICICI)).not.toBe(smsHash(ICICI.replace("370.00", "371.00")));
  });
});
