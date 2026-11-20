import pg from "pg";
import { requireEnv } from "./env";

// Return NUMERIC as string (default) so money is never coerced to float.

const globalForPool = globalThis as unknown as { cashbucktPool?: pg.Pool };

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
    // Readable IST timestamps in any ad-hoc output; storage stays UTC.
    options: "-c TimeZone=Asia/Kolkata",
  });
  // An idle client erroring (e.g. Postgres restart) must not crash the process.
  pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });
  return pool;
}

/** Shared pool, reused across hot reloads in dev. */
export function getPool(): pg.Pool {
  globalForPool.cashbucktPool ??= createPool(requireEnv("DATABASE_URL"));
  return globalForPool.cashbucktPool;
}

/** Close and forget the shared pool (shutdown, tests). The next getPool() recreates it. */
export async function closePool(): Promise<void> {
  const pool = globalForPool.cashbucktPool;
  globalForPool.cashbucktPool = undefined;
  await pool?.end();
}
