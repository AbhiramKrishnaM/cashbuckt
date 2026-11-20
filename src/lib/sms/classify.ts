import { toPaise } from "./amount";
import { type Channel, type ClassifiedSms, isCardSource, isSavingsSource, type ParsedSms } from "./types";

export type ClassifyConfig = {
  /** Names that mean "me" in a counterparty field, e.g. ["RAVI KUMAR"]. */
  ownerNamePatterns: string[];
  /** Last digits of the owner's credit cards, e.g. ["9001", "4402"]. */
  ownCardSuffixes: string[];
  /** Minimum ICICI NEFT credit treated as salary, decimal string. */
  salaryMinAmount: string;
};

/** Counterparties that mean "paying a credit-card bill". Extend as real SMS show more. */
export const CARD_PAYMENT_PARTIES = /CREDIT CARD|\bCRED\b|ONECARD|BILLDESK CC/i;

const AUTOPAY_ACRONYM = /\b(?:ACH|NACH|ECS|EMI|SI)\b/; // case-sensitive on purpose
const AUTOPAY_WORDS = /\bauto[- ]?(?:debit|pay)\b|\bmandate\b|\bstanding instruction\b/i;
const NEFT = /\bNEFT\b/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matchesOwner(party: string | null, patterns: string[]): boolean {
  if (!party) return false;
  return patterns.some((p) => p.trim() && new RegExp(`\\b${escapeRe(p.trim())}\\b`, "i").test(party));
}

function mentionsOwnCard(party: string | null, suffixes: string[]): boolean {
  if (!party) return false;
  return suffixes.some((s) => s.trim() && new RegExp(`(?:^|\\D)${escapeRe(s.trim())}(?:\\D|$)`).test(party));
}

function channelFor(p: ParsedSms, sms: string, cfg: ClassifyConfig): Channel {
  const savings = isSavingsSource(p.source) || p.source === "UNKNOWN";

  // 1. Credit-card bill payments (both sides).
  if (p.kind === "card_payment_received") return "CARD_PAYMENT";
  if (
    savings &&
    p.direction === "OUT" &&
    (CARD_PAYMENT_PARTIES.test(p.counterparty ?? "") || mentionsOwnCard(p.counterparty, cfg.ownCardSuffixes))
  ) {
    return "CARD_PAYMENT";
  }

  // 2. Money to/from the owner's own accounts, by name.
  if (savings && matchesOwner(p.counterparty, cfg.ownerNamePatterns)) return "SELF_TRANSFER";

  // 3. Salary: ICICI savings, NEFT, at least the configured minimum.
  if (
    p.direction === "IN" &&
    p.source === "ICICI" &&
    NEFT.test(sms) &&
    toPaise(p.amount) >= toPaise(cfg.salaryMinAmount)
  ) {
    return "SALARY";
  }

  // 4. Auto-debits / EMIs from savings.
  if (savings && p.direction === "OUT" && (AUTOPAY_ACRONYM.test(sms) || AUTOPAY_WORDS.test(sms))) {
    return "EMI_AUTOPAY";
  }

  // 5. Card spends.
  if (isCardSource(p.source) && p.direction === "OUT") return "CARD";

  // 6. Everything else.
  return p.direction === "OUT" ? "UPI" : "OTHER_IN";
}

/** Assign channel and note-prompt flag (merchant rules are applied later, at ingest). */
export function classify(parsed: ParsedSms, sms: string, cfg: ClassifyConfig): ClassifiedSms {
  const channel = channelFor(parsed, sms, cfg);
  const needsNote = parsed.direction === "OUT" && (channel === "UPI" || channel === "CARD");
  return { ...parsed, channel, needsNote };
}
