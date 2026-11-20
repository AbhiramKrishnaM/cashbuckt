import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Constant-time secret comparison (hashing first makes lengths equal). */
export function secretMatches(provided: string | null, expected: string): boolean {
  if (provided === null || expected === "") return false;
  return timingSafeEqual(digest(provided), digest(expected));
}
