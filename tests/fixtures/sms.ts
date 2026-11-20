import type { Channel, Direction, Source } from "@/lib/sms/types";

/**
 * SMS fixtures. `confirmed: true` = masked copy of a real SMS the owner
 * received. `confirmed: false` = representative format; replace with a real
 * masked sample (and flip to true) before relying on that parser.
 */
export type TxnFixture = {
  name: string;
  sms: string;
  confirmed: boolean;
  expected: {
    source: Source;
    direction: Direction;
    amount: string;
    counterparty: string | null;
    accountRef: string | null;
    date: string | null; // YYYY-MM-DD
    channel: Channel;
    needsNote: boolean;
  };
};

export type NoiseFixture = { name: string; sms: string; confirmed: boolean };

export const TXN_FIXTURES: TxnFixture[] = [
  {
    name: "ICICI UPI debit (MOMO WANG)",
    confirmed: true,
    sms: "ICICI Bank Acct XX123 debited for Rs 370.00 on 20-Nov-26; MOMO WANG credited. UPI:600000000001. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766",
    expected: {
      source: "ICICI",
      direction: "OUT",
      amount: "370.00",
      counterparty: "MOMO WANG",
      accountRef: "ICICI XX123",
      date: "2026-11-20",
      channel: "UPI",
      needsNote: true,
    },
  },
  {
    name: "ICICI NEFT salary credit",
    confirmed: false,
    sms: "ICICI Bank Account XX123 credited:Rs. 1,42,000.00 on 27-Nov-26. Info NEFT-CITIN26331XXXXXX-ACME TECH PVT LTD. Available Balance is Rs. 1,62,000.00.",
    expected: {
      source: "ICICI",
      direction: "IN",
      amount: "142000.00",
      counterparty: "ACME TECH PVT LTD",
      accountRef: "ICICI XX123",
      date: "2026-11-27",
      channel: "SALARY",
      needsNote: false,
    },
  },
  {
    name: "ICICI ACH EMI debit",
    confirmed: false,
    sms: "ICICI Bank Acct XX123 is debited with INR 2,924.00 on 05-Dec-26 towards ACH-DR IDFC FIRST BANK LTD.",
    expected: {
      source: "ICICI",
      direction: "OUT",
      amount: "2924.00",
      counterparty: "ACH-DR IDFC FIRST BANK LTD",
      accountRef: "ICICI XX123",
      date: "2026-12-05",
      channel: "EMI_AUTOPAY",
      needsNote: false,
    },
  },
  {
    name: "ICICI card-bill payment via CRED",
    confirmed: false,
    sms: "ICICI Bank Acct XX123 debited for Rs 5,000.00 on 20-Nov-26; CRED Club credited. UPI:600000000006. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766",
    expected: {
      source: "ICICI",
      direction: "OUT",
      amount: "5000.00",
      counterparty: "CRED Club",
      accountRef: "ICICI XX123",
      date: "2026-11-20",
      channel: "CARD_PAYMENT",
      needsNote: false,
    },
  },
  {
    name: "ICICI transfer to own account (owner name)",
    confirmed: false,
    sms: "ICICI Bank Acct XX123 debited for Rs 10,000.00 on 20-Nov-26; RAVI KUMAR credited. UPI:600000000008. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766",
    expected: {
      source: "ICICI",
      direction: "OUT",
      amount: "10000.00",
      counterparty: "RAVI KUMAR",
      accountRef: "ICICI XX123",
      date: "2026-11-20",
      channel: "SELF_TRANSFER",
      needsNote: false,
    },
  },
  {
    name: "ICICI credit card spend",
    confirmed: false,
    sms: "INR 1,250.00 spent using ICICI Bank Card XX9001 on 20-Nov-26 on AMAZON PAY. Avl Limit: INR 1,00,000.00. If not you, call 1800 2662/SMS BLOCK 9001 to 9215676766.",
    expected: {
      source: "ICICI_CC",
      direction: "OUT",
      amount: "1250.00",
      counterparty: "AMAZON PAY",
      accountRef: "ICICI_CC XX9001",
      date: "2026-11-20",
      channel: "CARD",
      needsNote: true,
    },
  },
  {
    name: "ICICI credit card payment received",
    confirmed: false,
    sms: "Payment of INR 5,000.00 has been received on your ICICI Bank Credit Card Account XX9001 on 20-Nov-26.",
    expected: {
      source: "ICICI_CC",
      direction: "IN",
      amount: "5000.00",
      counterparty: null,
      accountRef: "ICICI_CC XX9001",
      date: "2026-11-20",
      channel: "CARD_PAYMENT",
      needsNote: false,
    },
  },
  {
    name: "SBI UPI debit (bare amount)",
    confirmed: false,
    sms: "Dear UPI user A/C X1234 debited by 250.0 on date 20Nov26 trf to SWIGGY Refno 600000000002. If not u? call 1800111109. -SBI",
    expected: {
      source: "SBI",
      direction: "OUT",
      amount: "250.00",
      counterparty: "SWIGGY",
      accountRef: "SBI XX1234",
      date: "2026-11-20",
      channel: "UPI",
      needsNote: true,
    },
  },
  {
    name: "SBI credit",
    confirmed: false,
    sms: "Dear SBI User, your A/c X1234-credited by Rs.1500 on 20Nov26 transfer from RAHUL K Ref No 600000000003 -SBI",
    expected: {
      source: "SBI",
      direction: "IN",
      amount: "1500.00",
      counterparty: "RAHUL K",
      accountRef: "SBI XX1234",
      date: "2026-11-20",
      channel: "OTHER_IN",
      needsNote: false,
    },
  },
  {
    name: "SBI large NEFT credit (not salary)",
    confirmed: false,
    sms: "Dear SBI User, your A/c X1234-credited by Rs.150000 on 27Nov26 transfer from NEFT ACME TECH PVT LTD Ref No 600000000007 -SBI",
    expected: {
      source: "SBI",
      direction: "IN",
      amount: "150000.00",
      counterparty: "NEFT ACME TECH PVT LTD",
      accountRef: "SBI XX1234",
      date: "2026-11-27",
      channel: "OTHER_IN",
      needsNote: false,
    },
  },
  {
    name: "Utkarsh UPI debit",
    confirmed: false,
    sms: "Rs.500.00 debited from your Utkarsh SFB A/c XX5678 on 20-11-2026 via UPI to zomato@hdfcbank. Ref 600000000004",
    expected: {
      source: "UTKARSH",
      direction: "OUT",
      amount: "500.00",
      counterparty: "zomato@hdfcbank",
      accountRef: "UTKARSH XX5678",
      date: "2026-11-20",
      channel: "UPI",
      needsNote: true,
    },
  },
  {
    name: "Kotak savings UPI 'Sent'",
    confirmed: false,
    sms: "Sent Rs.1,200.00 from Kotak Bank AC X9012 to swiggy@icici on 20-11-26.UPI Ref 600000000005. Not you, https://kotak.com/KBANKT/Fraud",
    expected: {
      source: "KOTAK",
      direction: "OUT",
      amount: "1200.00",
      counterparty: "swiggy@icici",
      accountRef: "KOTAK XX9012",
      date: "2026-11-20",
      channel: "UPI",
      needsNote: true,
    },
  },
  {
    name: "Kotak savings UPI 'Received'",
    confirmed: false,
    sms: "Received Rs.500.00 in your Kotak Bank AC X9012 from friend@okaxis on 21-11-26.UPI Ref 600000000009.",
    expected: {
      source: "KOTAK",
      direction: "IN",
      amount: "500.00",
      counterparty: "friend@okaxis",
      accountRef: "KOTAK XX9012",
      date: "2026-11-21",
      channel: "OTHER_IN",
      needsNote: false,
    },
  },
  {
    name: "Kotak credit card spend",
    confirmed: false,
    sms: "Rs.899.00 spent on Kotak Credit Card XX4402 at AMAZON on 20/11/2026. Avl limit Rs.50,000.00",
    expected: {
      source: "KOTAK_CC",
      direction: "OUT",
      amount: "899.00",
      counterparty: "AMAZON",
      accountRef: "KOTAK_CC XX4402",
      date: "2026-11-20",
      channel: "CARD",
      needsNote: true,
    },
  },
  {
    name: "Kotak credit card refund",
    confirmed: false,
    sms: "Refund of Rs 899.00 credited to your Kotak Credit Card XX4402 from AMAZON on 22/11/2026.",
    expected: {
      source: "KOTAK_CC",
      direction: "IN",
      amount: "899.00",
      counterparty: "AMAZON",
      accountRef: "KOTAK_CC XX4402",
      date: "2026-11-22",
      channel: "OTHER_IN",
      needsNote: false,
    },
  },
  {
    name: "OneCard spend",
    confirmed: false,
    sms: "You've spent Rs. 650 at ZOMATO on your OneCard credit card ending 7788.",
    expected: {
      source: "ONECARD",
      direction: "OUT",
      amount: "650.00",
      counterparty: "ZOMATO",
      accountRef: "ONECARD XX7788",
      date: null,
      channel: "CARD",
      needsNote: true,
    },
  },
];

export const NOISE_FIXTURES: NoiseFixture[] = [
  {
    name: "IDFC FIRST personal loan EMI reminder",
    confirmed: true,
    sms: "Your Personal loan EMI is due tomorrow. Maintain Rs.2,924.00 in your registered bank A/c. today https://idfcft.bank.in/IDFCFB/kP57XM IDFC FIRST Bank.TCA",
  },
  {
    name: "Card OTP",
    confirmed: false,
    sms: "123456 is the OTP for transaction of INR 1,250.00 on your ICICI Bank Credit Card XX9001. Do not share it with anyone.",
  },
  {
    name: "Declined Kotak card transaction",
    confirmed: false,
    sms: "Transaction of Rs.899.00 on Kotak Credit Card XX4402 has been declined due to insufficient limit.",
  },
  {
    name: "Future auto-debit notice",
    confirmed: false,
    sms: "Rs.2,924.00 will be debited from your ICICI Bank Acct XX123 on 05-Dec-26 towards ACH IDFC FIRST BANK.",
  },
  {
    name: "UPI collect request",
    confirmed: false,
    sms: "SWIGGY has requested money from you on Google Pay. On approving, Rs 450.00 will be debited from your account.",
  },
];

/** Authenticated, not noise, but no parser can read it. */
export const UNRECOGNIZED_SMS =
  "Dear Customer, Rs 5,000.00 has been processed for A/c **4410 via ABC-NET ref 99887766.";

/** Owner config used by classification fixtures. */
export const TEST_CONFIG = {
  ownerNamePatterns: ["RAVI KUMAR", "RAVI K"],
  ownCardSuffixes: ["9001", "4402", "7788"],
  salaryMinAmount: "100000.00",
};
