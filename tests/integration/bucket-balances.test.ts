import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, insertBucket, insertTxn, withRollback } from "../helpers/db";

afterAll(closeTestPool);

type Balance = {
  month_key: string;
  opening_balance: string;
  money_in: string;
  money_out: string;
  closing_balance: string;
};

async function balances(c: pg.PoolClient): Promise<Record<string, Balance>> {
  const { rows } = await c.query<Balance>(
    `SELECT month_key, opening_balance::text, money_in::text, money_out::text, closing_balance::text
     FROM bucket_balances ORDER BY month_key`,
  );
  return Object.fromEntries(rows.map((r) => [r.month_key, r]));
}

describe("bucket_balances view", () => {
  it("seeds the first month from opening_adjustment and carries closing into the next month", () =>
    withRollback(async (c) => {
      const nov = await insertBucket(c, "2026-11", "November 2026", "20000.00");
      await insertBucket(c, "2026-12", "December 2026");
      await insertTxn(c, nov, { amount: "3000.00" });

      const b = await balances(c);
      expect(b["2026-11"]).toMatchObject({
        opening_balance: "20000.00",
        money_in: "0.00",
        money_out: "3000.00",
        closing_balance: "17000.00",
      });
      expect(b["2026-12"].opening_balance).toBe("17000.00");
    }));

  it("lowers next month's opening when a late debit lands in the prior month", () =>
    withRollback(async (c) => {
      const nov = await insertBucket(c, "2026-11", "November 2026", "20000.00");
      const dec = await insertBucket(c, "2026-12", "December 2026");
      // Salary on Nov 27 is assigned to December's bucket.
      await insertTxn(c, dec, { txn_type: "IN", channel: "SALARY", amount: "142000.00" });

      const before = (await balances(c))["2026-12"];
      expect(before.opening_balance).toBe("20000.00");
      expect(before.closing_balance).toBe("162000.00");

      // A ₹500 UPI spend on Nov 29 still belongs to November.
      await insertTxn(c, nov, { amount: "500.00" });

      const after = (await balances(c))["2026-12"];
      expect(after.opening_balance).toBe("19500.00");
      expect(after.closing_balance).toBe("161500.00");
    }));

  it("applies a mid-history opening_adjustment only from its own month onward", () =>
    withRollback(async (c) => {
      await insertBucket(c, "2026-11", "November 2026", "1000.00");
      await insertBucket(c, "2026-12", "December 2026", "-200.00");
      await insertBucket(c, "2027-01", "January 2027");

      const b = await balances(c);
      expect(b["2026-11"].closing_balance).toBe("1000.00");
      expect(b["2026-12"].opening_balance).toBe("800.00");
      expect(b["2027-01"].opening_balance).toBe("800.00");
    }));
});
