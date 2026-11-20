import { afterAll, describe, expect, it, vi } from "vitest";
import { createPool } from "@/lib/db";
import { checkHealth } from "@/lib/health";
import { closeTestPool, testPool } from "../helpers/db";

afterAll(closeTestPool);

describe("checkHealth", () => {
  it("returns 200 ok when the database is reachable", async () => {
    const result = await checkHealth(testPool);
    expect(result).toEqual({ httpStatus: 200, body: { status: "ok", db: "ok" } });
  });

  it("returns 503 degraded with no connection details when the database is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const url = "postgres://cashbuckt:hunter2-secret@127.0.0.1:1/cashbuckt";
    const pool = createPool(url);
    try {
      const result = await checkHealth(() => pool);
      expect(result).toEqual({ httpStatus: 503, body: { status: "degraded", db: "down" } });
      const json = JSON.stringify(result.body);
      for (const leak of ["hunter2", "127.0.0.1", "postgres://", "ECONNREFUSED"]) {
        expect(json).not.toContain(leak);
      }
    } finally {
      await pool.end();
    }
  });

  it("returns 503 when config is missing instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await checkHealth(() => {
      throw new Error("Missing required environment variable: DATABASE_URL");
    });
    expect(result.httpStatus).toBe(503);
  });
});
