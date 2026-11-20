import { describe, expect, it } from "vitest";
import { isNoise } from "@/lib/sms/noise";
import { NOISE_FIXTURES, TXN_FIXTURES, UNRECOGNIZED_SMS } from "../../fixtures/sms";

describe("isNoise", () => {
  it.each(NOISE_FIXTURES.map((f) => [f.name, f.sms]))("%s is noise", (_name, sms) => {
    expect(isNoise(sms)).toBe(true);
  });

  it.each(TXN_FIXTURES.map((f) => [f.name, f.sms]))("%s is not noise", (_name, sms) => {
    expect(isNoise(sms)).toBe(false);
  });

  it("does not treat an unrecognized money SMS as noise", () => {
    expect(isNoise(UNRECOGNIZED_SMS)).toBe(false);
  });

  it("keeps a reversal of a failed transaction (it returns money)", () => {
    expect(isNoise("Rs 500.00 credited to your A/c XX99 towards reversal of failed UPI txn Ref 123.")).toBe(false);
  });
});
