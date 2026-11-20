import type pg from "pg";
import { monthLabel } from "./sms/month";

/**
 * Return the bucket id for `monthKey`, creating the bucket if needed.
 * Safe under concurrency: a racing insert of the same month waits on the
 * unique index, then does nothing, and the SELECT sees the committed row.
 */
export async function ensureBucket(client: pg.PoolClient, monthKey: string): Promise<number> {
  await client.query(
    `INSERT INTO month_buckets (month_key, label) VALUES ($1, $2)
     ON CONFLICT (month_key) DO NOTHING`,
    [monthKey, monthLabel(monthKey)],
  );
  const { rows } = await client.query<{ id: number }>("SELECT id FROM month_buckets WHERE month_key = $1", [
    monthKey,
  ]);
  return rows[0].id;
}
