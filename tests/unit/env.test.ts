import { describe, expect, it } from "vitest";
import { MissingEnvError, requireEnv, validateEnv } from "@/lib/env";

const SECRET = "s3cr3t-password-should-never-appear";

describe("env validation", () => {
  it("names the missing DATABASE_URL without leaking any secret values", () => {
    const env = { POSTGRES_PASSWORD: SECRET, WEBHOOK_SECRET: SECRET };
    let err: unknown;
    try {
      validateEnv(env);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MissingEnvError);
    expect((err as Error).message).toContain("DATABASE_URL");
    expect((err as Error).message).not.toContain(SECRET);
  });

  it("treats blank values as missing", () => {
    expect(() => requireEnv("DATABASE_URL", { DATABASE_URL: "  " })).toThrow(MissingEnvError);
  });

  it("returns the value when present", () => {
    expect(requireEnv("DATABASE_URL", { DATABASE_URL: "postgres://x" })).toBe("postgres://x");
  });
});
