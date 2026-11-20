import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, insertBucket, insertTxn, PG, sha256, withRollback } from "../helpers/db";

afterAll(closeTestPool);

async function totals(c: pg.PoolClient, monthKey: string) {
  const { rows } = await c.query(
    "SELECT money_in::text, money_out::text, closing_balance::text FROM bucket_balances WHERE month_key = $1",
    [monthKey],
  );
  return rows[0];
}

describe("transactions: bank and channels", () => {
  it("rejects an unknown bank", () =>
    withRollback(async (c) => {
      const b = await insertBucket(c, "2026-11", "November 2026");
      await expect(insertTxn(c, b, { bank: "HDFC" })).rejects.toMatchObject({ code: PG.CHECK_VIOLATION });
    }));

  it.each(["ICICI", "SBI", "UTKARSH", "KOTAK", "ICICI_CC", "KOTAK_CC", "ONECARD", "UNKNOWN"])(
    "accepts bank %s",
    (bank) =>
      withRollback(async (c) => {
        const b = await insertBucket(c, "2026-11", "November 2026");
        await insertTxn(c, b, { bank });
      }),
  );

  it.each(["CARD_PAYMENT", "SELF_TRANSFER"])("accepts new channel %s", (channel) =>
    withRollback(async (c) => {
      const b = await insertBucket(c, "2026-11", "November 2026");
      await insertTxn(c, b, { channel });
    }),
  );
});

describe("bucket_balances excludes transfers and card-bill payments", () => {
  it("counts only the card spend", () =>
    withRollback(async (c) => {
      const b = await insertBucket(c, "2026-11", "November 2026");
      await insertTxn(c, b, { channel: "CARD", amount: "899.00", bank: "KOTAK_CC" });
      await insertTxn(c, b, { channel: "CARD_PAYMENT", amount: "899.00", bank: "ICICI" });
      await insertTxn(c, b, { channel: "CARD_PAYMENT", txn_type: "IN", amount: "899.00", bank: "KOTAK_CC" });
      await insertTxn(c, b, { channel: "SELF_TRANSFER", amount: "10000.00", bank: "ICICI" });
      await insertTxn(c, b, { channel: "SELF_TRANSFER", txn_type: "IN", amount: "10000.00", bank: "SBI" });

      expect(await totals(c, "2026-11")).toEqual({
        money_in: "0.00",
        money_out: "899.00",
        closing_balance: "-899.00",
      });
    }));
});

describe("unparsed_sms", () => {
  const insertUnparsed = (c: pg.PoolClient, sms: string) =>
    c.query("INSERT INTO unparsed_sms (raw_sms, sms_hash) VALUES ($1, $2)", [sms, sha256(sms)]);

  it("rejects a duplicate hash", () =>
    withRollback(async (c) => {
      const sms = "Dear Customer, Rs 5,000.00 has been processed for A/c **4410 via ABC-NET ref 99887766.";
      await insertUnparsed(c, sms);
      await expect(insertUnparsed(c, sms)).rejects.toMatchObject({ code: PG.UNIQUE_VIOLATION });
    }));

  it("defaults reviewed to false and does not affect balances", () =>
    withRollback(async (c) => {
      await insertBucket(c, "2026-11", "November 2026", "1000.00");
      const before = await totals(c, "2026-11");
      await insertUnparsed(c, "Dear Customer, Rs 5,000.00 has been processed for A/c **4410.");
      const { rows } = await c.query("SELECT reviewed FROM unparsed_sms");
      expect(rows).toEqual([{ reviewed: false }]);
      expect(await totals(c, "2026-11")).toEqual(before);
    }));
});
