import { createHash } from "node:crypto";

/** Trim and collapse every whitespace run (spaces, tabs, newlines) to one space. */
export function normalizeSms(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** SHA-256 hex of the normalized SMS: the dedup key across all storage. */
export function smsHash(raw: string): string {
  return createHash("sha256").update(normalizeSms(raw), "utf8").digest("hex");
}
