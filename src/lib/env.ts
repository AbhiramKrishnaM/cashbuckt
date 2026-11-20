/**
 * Server-side environment access. Errors name the missing key but never
 * echo any value, so secrets cannot leak into logs.
 */

/** Variables the server cannot start without. Later changes append to this list. */
export const REQUIRED_ENV = ["DATABASE_URL", "WEBHOOK_SECRET"] as const;

export type RequiredEnvKey = (typeof REQUIRED_ENV)[number];

type Env = Record<string, string | undefined>;

export class MissingEnvError extends Error {
  constructor(public readonly key: string) {
    super(`Missing required environment variable: ${key}`);
    this.name = "MissingEnvError";
  }
}

export function requireEnv(key: string, env: Env = process.env): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") throw new MissingEnvError(key);
  return value;
}

/** Throws on the first missing required variable. Called once at server startup. */
export function validateEnv(env: Env = process.env): void {
  for (const key of REQUIRED_ENV) requireEnv(key, env);
}
