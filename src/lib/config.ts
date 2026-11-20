import { toAmount } from "./sms/amount";
import type { ClassifyConfig } from "./sms/classify";

type Env = Record<string, string | undefined>;

export const DEFAULT_SALARY_MIN_AMOUNT = "100000.00";

/** "a, b,,c " -> ["a", "b", "c"] */
export function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Classification config from env. Throws (naming the key) on an invalid salary amount. */
export function loadClassifyConfig(env: Env = process.env): ClassifyConfig {
  const rawSalary = env.SALARY_MIN_AMOUNT?.trim();
  const salaryMinAmount = rawSalary ? toAmount(rawSalary) : DEFAULT_SALARY_MIN_AMOUNT;
  if (!salaryMinAmount) {
    throw new Error("Invalid SALARY_MIN_AMOUNT: expected a positive amount like 100000");
  }
  return {
    ownerNamePatterns: parseList(env.OWNER_NAME_PATTERNS),
    ownCardSuffixes: parseList(env.OWN_CARD_SUFFIXES),
    salaryMinAmount,
  };
}
