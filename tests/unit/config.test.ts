import { describe, expect, it } from "vitest";
import { DEFAULT_SALARY_MIN_AMOUNT, loadClassifyConfig, parseList } from "@/lib/config";

describe("parseList", () => {
  it("splits, trims and drops empties", () => {
    expect(parseList(" RAVI KUMAR, RAVI K ,, ")).toEqual(["RAVI KUMAR", "RAVI K"]);
  });

  it("handles undefined", () => {
    expect(parseList(undefined)).toEqual([]);
  });
});

describe("loadClassifyConfig", () => {
  it("defaults the salary minimum to ₹1,00,000", () => {
    expect(loadClassifyConfig({})).toEqual({
      ownerNamePatterns: [],
      ownCardSuffixes: [],
      salaryMinAmount: DEFAULT_SALARY_MIN_AMOUNT,
    });
    expect(DEFAULT_SALARY_MIN_AMOUNT).toBe("100000.00");
  });

  it("reads all keys", () => {
    expect(
      loadClassifyConfig({
        OWNER_NAME_PATTERNS: "RAVI KUMAR,RAVI K",
        OWN_CARD_SUFFIXES: "9001, 4402,7788",
        SALARY_MIN_AMOUNT: "1,20,000",
      }),
    ).toEqual({
      ownerNamePatterns: ["RAVI KUMAR", "RAVI K"],
      ownCardSuffixes: ["9001", "4402", "7788"],
      salaryMinAmount: "120000.00",
    });
  });

  it("rejects an invalid salary amount, naming the key", () => {
    expect(() => loadClassifyConfig({ SALARY_MIN_AMOUNT: "lots" })).toThrow(/SALARY_MIN_AMOUNT/);
  });
});
