import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, insertBucket, insertTxn, PG, sha256, withRollback } from "../helpers/db";

afterAll(closeTestPool);

/** Asserts the promise rejects with the given Postgres SQLSTATE code. */
async function expectPgError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

describe("month buckets", () => {
  it("rejects a duplicate month_key and leaves the existing bucket unchanged", () =>
    withRollback(async (c) => {
      await insertBucket(c, "2026-12", "December 2026");
      await c.query("SAVEPOINT s");
      await expectPgError(insertBucket(c, "2026-12", "Dup"), PG.UNIQUE_VIOLATION);
      await c.query("ROLLBACK TO SAVEPOINT s");
      const { rows } = await c.query("SELECT label FROM month_buckets WHERE month_key = '2026-12'");
      expect(rows).toEqual([{ label: "December 2026" }]);
    }));

  it.each(["2026-13", "Dec-202", "2026-1", "2026-00"])("rejects malformed month_key %s", (key) =>
    withRollback((c) => expectPgError(insertBucket(c, key, "Bad"), PG.CHECK_VIOLATION)),
  );

  it("rejects an over-long month_key like Dec-2026", () =>
    withRollback((c) => expectPgError(insertBucket(c, "Dec-2026", "Bad"), PG.STRING_TOO_LONG)),
  );
});

describe("transactions", () => {
  it.each([
    ["txn_type", { txn_type: "DEBIT" }],
    ["channel", { channel: "CASH" }],
  ])("rejects invalid %s", (_name, fields) =>
    withRollback(async (c) => {
      const b = await insertBucket(c, "2026-11", "November 2026");
      await expectPgError(insertTxn(c, b, fields), PG.CHECK_VIOLATION);
    }),
  );

  it.each(["0", "-50.00"])("rejects non-positive amount %s", (amount) =>
    withRollback(async (c) => {
      const b = await insertBucket(c, "2026-11", "November 2026");
      await expectPgError(insertTxn(c, b, { amount }), PG.CHECK_VIOLATION);
    }),
  );

  it("sums money exactly with no floating-point error", () =>
    withRollback(async (c) => {
      const b = await insertBucket(c, "2026-12", "December 2026");
      await insertTxn(c, b, { txn_type: "IN", channel: "SALARY", amount: "142000.00" });
      await insertTxn(c, b, { txn_type: "IN", channel: "OTHER_IN", amount: "2.50" });
      const { rows } = await c.query("SELECT SUM(amount)::text AS total FROM transactions WHERE bucket_id = $1", [b]);
      expect(rows[0].total).toBe("142002.50");
    }));

  it("rejects a second transaction with the same sms_hash", () =>
    withRollback(async (c) => {
      const b = await insertBucket(c, "2026-11", "November 2026");
      const sms = "Rs.250.00 debited from A/c XX1234 to VPA shop@okaxis UPI Ref 123456789012";
      await insertTxn(c, b, { sms });
      await c.query("SAVEPOINT s");
      await expectPgError(insertTxn(c, b, { sms }), PG.UNIQUE_VIOLATION);
      await c.query("ROLLBACK TO SAVEPOINT s");
      const { rows } = await c.query("SELECT count(*)::int AS n FROM transactions WHERE sms_hash = $1", [sha256(sms)]);
      expect(rows[0].n).toBe(1);
    }));
});

describe("bucket deletion safety", () => {
  it("blocks deleting a bucket that has transactions", () =>
    withRollback(async (c) => {
      const b = await insertBucket(c, "2026-11", "November 2026");
      await insertTxn(c, b);
      await c.query("SAVEPOINT s");
      await expectPgError(c.query("DELETE FROM month_buckets WHERE id = $1", [b]), PG.FOREIGN_KEY_VIOLATION);
      await c.query("ROLLBACK TO SAVEPOINT s");
      const { rows } = await c.query("SELECT count(*)::int AS n FROM transactions WHERE bucket_id = $1", [b]);
      expect(rows[0].n).toBe(1);
    }));
});

describe("push subscriptions", () => {
  it("rejects a duplicate endpoint", () =>
    withRollback(async (c) => {
      const sql = "INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ($1, 'k', 'a')";
      const endpoint = "https://web.push.apple.com/QAbc123";
      await c.query(sql, [endpoint]);
      await expectPgError(c.query(sql, [endpoint]), PG.UNIQUE_VIOLATION);
    }));
});
