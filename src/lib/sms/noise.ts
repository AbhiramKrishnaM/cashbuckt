/**
 * Noise = SMS that are not completed money movements. These are dropped
 * without storing (spec: "Noise dropped without storing").
 */

/** Unconditional noise: never a completed transaction. */
const ALWAYS_NOISE: RegExp[] = [
  /\bOTP\b/i,
  /\bone[- ]time password\b/i,
  /\bverification code\b/i,
  /\bis due\b/i,
  /\bdue (?:on|tomorrow|today|date|by)\b/i,
  /\bwill be (?:debited|deducted|auto[- ]?debited)\b/i,
  /\bhas requested\b/i,
  /\brequested (?:money|Rs|INR|₹)/i,
  /\bcollect request\b/i,
  /\bscheduled\b/i,
  /\breminder\b/i,
  /\bpre-?approved\b/i,
  /\bapply now\b/i,
];

/** Failure words are noise unless the SMS is actually returning money. */
const FAILURE = /\b(?:declined|failed|unsuccessful|rejected)\b/i;
const MONEY_RETURNED = /\b(?:reversal|reversed|refund(?:ed)?)\b/i;

export function isNoise(sms: string): boolean {
  if (ALWAYS_NOISE.some((re) => re.test(sms))) return true;
  if (FAILURE.test(sms) && !MONEY_RETURNED.test(sms)) return true;
  return false;
}
