import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import pg from "pg";

/**
 * Integration tests run against an isolated `cashbuckt_test` database inside
 * the dev Postgres from compose.dev.yml (recreated by tests/global-setup.ts):
 *   docker compose -f docker-compose.yml -f compose.dev.yml up -d postgres
 * Override with TEST_DATABASE_URL to point at a database you manage.
 */
export const TEST_DB_NAME = "cashbuckt_test";

function devServerUrl(database: string): string {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = process.env;
  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) {
    throw new Error("Set TEST_DATABASE_URL or POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB in .env");
  }
  const port = process.env.DEV_PG_PORT ?? "55432";
  return `postgres://${POSTGRES_USER}:${encodeURIComponent(POSTGRES_PASSWORD)}@127.0.0.1:${port}/${database}`;
}

/** The dev database, used only to (re)create the test database. */
export function adminDatabaseUrl(): string {
  return devServerUrl(process.env.POSTGRES_DB ?? "cashbuckt");
}

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? devServerUrl(TEST_DB_NAME);
}

let pool: pg.Pool | undefined;

export function testPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: testDatabaseUrl(), max: 5 });
  return pool;
}

export async function closeTestPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Runs fn inside a transaction that is always rolled back, so tests leave no data. */
export async function withRollback<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await testPool().connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/** For test files that commit data: wipe all app tables (test database only). */
export async function truncateAll(): Promise<void> {
  await testPool().query(
    "TRUNCATE transactions, month_buckets, unparsed_sms, merchant_rules, push_subscriptions RESTART IDENTITY CASCADE",
  );
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Postgres SQLSTATE codes used in assertions. */
export const PG = {
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",
  FOREIGN_KEY_VIOLATION: "23503",
  STRING_TOO_LONG: "22001",
} as const;

export async function insertBucket(
  c: pg.PoolClient,
  monthKey: string,
  label: string,
  openingAdjustment = "0.00",
): Promise<number> {
  const { rows } = await c.query<{ id: number }>(
    "INSERT INTO month_buckets (month_key, label, opening_adjustment) VALUES ($1, $2, $3) RETURNING id",
    [monthKey, label, openingAdjustment],
  );
  return rows[0].id;
}

let smsCounter = 0;

export async function insertTxn(
  c: pg.PoolClient,
  bucketId: number,
  fields: { txn_type?: string; channel?: string; amount?: string; sms?: string; bank?: string } = {},
): Promise<void> {
  const sms = fields.sms ?? `test sms ${Date.now()} ${smsCounter++}`;
  await c.query(
    `INSERT INTO transactions (bucket_id, txn_type, channel, amount, raw_sms, sms_hash, bank)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      bucketId,
      fields.txn_type ?? "OUT",
      fields.channel ?? "UPI",
      fields.amount ?? "10.00",
      sms,
      sha256(sms),
      fields.bank ?? "UNKNOWN",
    ],
  );
}
