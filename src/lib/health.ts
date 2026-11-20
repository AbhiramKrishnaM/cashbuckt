import type pg from "pg";

export type HealthResult =
  | { httpStatus: 200; body: { status: "ok"; db: "ok" } }
  | { httpStatus: 503; body: { status: "degraded"; db: "down" } };

const DOWN: HealthResult = { httpStatus: 503, body: { status: "degraded", db: "down" } };

/**
 * Pings the database. Never surfaces error details (they can contain
 * hostnames or connection strings); those go to server logs only.
 */
export async function checkHealth(getPool: () => pg.Pool, timeoutMs = 2_000): Promise<HealthResult> {
  try {
    const pool = getPool();
    const ping = pool.query("SELECT 1");
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("health check timed out")), timeoutMs).unref(),
    );
    await Promise.race([ping, timeout]);
    return { httpStatus: 200, body: { status: "ok", db: "ok" } };
  } catch (err) {
    console.error("[health] database check failed:", (err as Error).message);
    return DOWN;
  }
}
