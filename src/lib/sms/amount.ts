/**
 * Money handling for SMS text. Amounts stay decimal strings end to end and
 * never pass through floating point.
 */

/** Regex fragment capturing a number like 1,42,000.00 / 142,000.00 / 250.0 / 650. */
export const AMT = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`;

/** Regex fragment for an optional-space currency marker. */
export const CUR = String.raw`(?:Rs\.?|INR|₹)\s?`;

/** "1,42,000.0" -> "142000.00". Returns null for anything that is not a positive amount. */
export function toAmount(raw: string): string | null {
  const digits = raw.replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(digits);
  if (!m) return null;
  const whole = m[1].replace(/^0+(?=\d)/, "");
  const frac = (m[2] ?? "").padEnd(2, "0");
  if (/^0+$/.test(whole) && /^0+$/.test(frac)) return null;
  return `${whole}.${frac}`;
}

/** Decimal string -> integer paise, for exact comparison. */
export function toPaise(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0").slice(0, 2));
}

const BALANCE_CONTEXT = /(?:bal(?:ance)?|limit|avl|available)[\s.:]*(?:is|of)?[\s.:]*$/i;

/**
 * Best-effort amount for SMS without a dedicated bank parser: the first
 * currency-marked (or "debited/credited by") amount that is not a balance
 * or credit-limit figure.
 */
export function extractAmount(sms: string): string | null {
  const candidates: { index: number; raw: string }[] = [];
  const marked = new RegExp(`${CUR}${AMT}`, "gi");
  const bare = new RegExp(String.raw`(?:debited|credited)\s+by\s+(?:${CUR})?${AMT}`, "gi");
  for (const re of [marked, bare]) {
    for (const m of sms.matchAll(re)) candidates.push({ index: m.index ?? 0, raw: m[1] });
  }
  candidates.sort((a, b) => a.index - b.index);
  for (const c of candidates) {
    const before = sms.slice(Math.max(0, c.index - 30), c.index);
    if (BALANCE_CONTEXT.test(before)) continue;
    const amount = toAmount(c.raw);
    if (amount) return amount;
  }
  return null;
}
