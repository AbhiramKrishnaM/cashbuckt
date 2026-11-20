import { describe, expect, it } from "vitest";
import { classify } from "@/lib/sms/classify";
import { parseSms } from "@/lib/sms/parsers";
import { TEST_CONFIG, TXN_FIXTURES } from "../../fixtures/sms";

function classifySms(sms: string, cfg = TEST_CONFIG) {
  const parsed = parseSms(sms);
  if (!parsed) throw new Error(`fixture did not parse: ${sms}`);
  return classify(parsed, sms, cfg);
}

describe("classification (every fixture)", () => {
  it.each(TXN_FIXTURES.map((f) => [f.name, f] as const))("%s", (_name, f) => {
    const c = classifySms(f.sms);
    expect({ channel: c.channel, needsNote: c.needsNote }).toEqual({
      channel: f.expected.channel,
      needsNote: f.expected.needsNote,
    });
  });
});

describe("salary rules", () => {
  const salary = TXN_FIXTURES.find((f) => f.expected.channel === "SALARY")!.sms;

  it("below the configured minimum is OTHER_IN", () => {
    expect(classifySms(salary, { ...TEST_CONFIG, salaryMinAmount: "150000.00" }).channel).toBe("OTHER_IN");
  });

  it("exactly at the minimum is SALARY", () => {
    expect(classifySms(salary, { ...TEST_CONFIG, salaryMinAmount: "142000.00" }).channel).toBe("SALARY");
  });

  it("ICICI credit without NEFT is not salary", () => {
    const imps = salary.replace("NEFT-", "IMPS-");
    expect(classifySms(imps).channel).toBe("OTHER_IN");
  });
});

describe("owner-name and own-card matching", () => {
  const toRavi = TXN_FIXTURES.find((f) => f.expected.channel === "SELF_TRANSFER")!.sms;

  it("does not self-transfer when no owner patterns are configured", () => {
    expect(classifySms(toRavi, { ...TEST_CONFIG, ownerNamePatterns: [] }).channel).toBe("UPI");
  });

  it("matches whole words only ('RAVI K' must not match 'RAVI KANT')", () => {
    const toRaviKant = toRavi.replace("RAVI KUMAR", "RAVI KANT");
    expect(classifySms(toRaviKant, { ...TEST_CONFIG, ownerNamePatterns: ["RAVI K"] }).channel).toBe("UPI");
  });

  it("treats a payment to one of the owner's card numbers as CARD_PAYMENT", () => {
    const toCard = toRavi.replace("RAVI KUMAR", "ICICI XX9001");
    expect(classifySms(toCard).channel).toBe("CARD_PAYMENT");
  });
});
