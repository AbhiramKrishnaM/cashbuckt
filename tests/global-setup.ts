import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { adminDatabaseUrl, TEST_DB_NAME, testDatabaseUrl } from "./helpers/db";

/**
 * Recreate an isolated test database (never the dev DB) and apply every
 * `-- migrate:up` section from db/migrations in order, like dbmate does.
 * Skipped when TEST_DATABASE_URL is provided (caller manages that DB).
 */
export default async function setup() {
  if (process.env.TEST_DATABASE_URL) return;

  const admin = new pg.Client({ connectionString: adminDatabaseUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const db = new pg.Client({ connectionString: testDatabaseUrl() });
  await db.connect();
  try {
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = readFileSync(join(dir, file), "utf8");
      const up = sql.split(/^-- migrate:down/m)[0].replace(/^-- migrate:up/m, "");
      await db.query(up);
    }
  } finally {
    await db.end();
  }
}
