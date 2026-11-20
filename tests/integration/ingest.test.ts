import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestSms } from "@/lib/ingest";
import { smsHash } from "@/lib/sms/normalize";
import { NOISE_FIXTURES, TEST_CONFIG, TXN_FIXTURES, UNRECOGNIZED_SMS } from "../fixtures/sms";
import { closeTestPool, testPool, truncateAll } from "../helpers/db";

const ist = (s: string) => new Date(`${s}+05:30`);
const fixture = (name: string) => TXN_FIXTURES.find((f) => f.name === name)!.sms;

const ICICI_UPI = fixture("ICICI UPI debit (MOMO WANG)");
const ICICI_SALARY = fixture("ICICI NEFT salary credit");
const NOV_20 = ist("2026-11-20T14:00:00");

const pool = testPool();
const ingest = (sms: string, at = NOV_20) => ingestSms(pool, sms, TEST_CONFIG, at);

async function count(table: string): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

/** ICICI debit to an unknown-looking party (so it is not a self-transfer by name). */
const iciciDebitTo = (party: string, amount: string, ref: string) =>
  `ICICI Bank Acct XX123 debited for Rs ${amount} on 20-Nov-26; ${party} credited. UPI:${ref}. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766`;
const sbiCredit = (amount: string, ref: string) =>
  `Dear SBI User, your A/c X1234-credited by Rs.${amount} on 20Nov26 transfer from MR R K Ref No ${ref} -SBI`;

beforeEach(truncateAll);
afterEach(truncateAll);

afterAll(closeTestPool);

describe("ingest results", () => {
  it("saves the ICICI UPI debit into 2026-11 with a note prompt", async () => {
    const r = await ingest(ICICI_UPI);
    expect(r).toMatchObject({ status: "saved", month: "2026-11", channel: "UPI", needsNote: true });
    const { rows } = await pool.query(
      "SELECT txn_type, amount::text, merchant_vpa, bank, account_ref, needs_note, sms_hash FROM transactions",
    );
    expect(rows).toEqual([
      {
        txn_type: "OUT",
        amount: "370.00",
        merchant_vpa: "MOMO WANG",
        bank: "ICICI",
        account_ref: "ICICI XX123",
        needs_note: true,
        sms_hash: smsHash(ICICI_UPI),
      },
    ]);
  });

  it("returns duplicate with the original id on re-send (whitespace-insensitive)", async () => {
    const first = await ingest(ICICI_UPI);
    const second = await ingest(`${ICICI_UPI}\n`);
    expect(second).toEqual({ status: "duplicate", id: (first as { id: string }).id });
    expect(await count("transactions")).toBe(1);
  });

  it.each(NOISE_FIXTURES.map((f) => [f.name, f.sms]))("ignores noise: %s", async (_name, sms) => {
    expect(await ingest(sms)).toEqual({ status: "ignored" });
    expect(await count("transactions")).toBe(0);
    expect(await count("unparsed_sms")).toBe(0);
  });

  it("captures an unrecognized SMS once, then reports duplicate", async () => {
    expect(await ingest(UNRECOGNIZED_SMS)).toEqual({ status: "unrecognized" });
    const again = await ingest(UNRECOGNIZED_SMS);
    expect(again.status).toBe("duplicate");
    expect(await count("unparsed_sms")).toBe(1);
    expect(await count("transactions")).toBe(0);
    expect(await count("month_buckets")).toBe(0);
  });

  it("puts the Nov 27 salary into an auto-created 2026-12 bucket", async () => {
    const r = await ingest(ICICI_SALARY, ist("2026-11-27T11:00:00"));
    expect(r).toMatchObject({ status: "saved", month: "2026-12", channel: "SALARY", needsNote: false });
    const { rows } = await pool.query("SELECT month_key, label, opening_adjustment::text FROM month_buckets");
    expect(rows).toEqual([{ month_key: "2026-12", label: "December 2026", opening_adjustment: "0.00" }]);
  });

  it("applies a skip-prompt merchant rule", async () => {
    await pool.query("INSERT INTO merchant_rules VALUES ('MOMO WANG', 'Snacks', true)");
    const r = await ingest(ICICI_UPI);
    expect(r).toMatchObject({ status: "saved", needsNote: false });
    const { rows } = await pool.query("SELECT user_note, needs_note FROM transactions");
    expect(rows).toEqual([{ user_note: "Snacks", needs_note: false }]);
  });

  it("a merchant rule without skip_prompt still prompts", async () => {
    await pool.query("INSERT INTO merchant_rules VALUES ('MOMO WANG', 'Snacks', false)");
    expect(await ingest(ICICI_UPI)).toMatchObject({ needsNote: true });
  });
});

describe("self-transfer pairing", () => {
  it("pairs a debit with a matching credit 3 minutes later", async () => {
    const out = await ingest(iciciDebitTo("MR R K", "10,000.00", "600000000101"), ist("2026-11-20T14:00:00"));
    expect(out).toMatchObject({ channel: "UPI", needsNote: true });
    const inn = await ingest(sbiCredit("10000", "600000000102"), ist("2026-11-20T14:03:00"));
    expect(inn).toMatchObject({ status: "saved", channel: "SELF_TRANSFER", needsNote: false });

    const { rows } = await pool.query(
      "SELECT channel, needs_note, transfer_pair_id FROM transactions ORDER BY transacted_at",
    );
    expect(rows.map((r) => [r.channel, r.needs_note])).toEqual([
      ["SELF_TRANSFER", false],
      ["SELF_TRANSFER", false],
    ]);
    expect(rows[0].transfer_pair_id).toBeTruthy();
    expect(rows[0].transfer_pair_id).toBe(rows[1].transfer_pair_id);
  });

  it("does not pair when 40 minutes apart", async () => {
    await ingest(iciciDebitTo("MR R K", "10,000.00", "600000000103"), ist("2026-11-20T14:00:00"));
    const inn = await ingest(sbiCredit("10000", "600000000104"), ist("2026-11-20T14:40:00"));
    expect(inn).toMatchObject({ channel: "OTHER_IN" });
    const { rows } = await pool.query("SELECT DISTINCT channel FROM transactions ORDER BY channel");
    expect(rows.map((r) => r.channel)).toEqual(["OTHER_IN", "UPI"]);
  });

  it("never pairs SALARY", async () => {
    await ingest(ICICI_SALARY, ist("2026-11-27T11:00:00"));
    const sbiOut = "Dear UPI user A/C X1234 debited by 142000.00 on date 27Nov26 trf to SOMEONE Refno 600000000105. If not u? call 1800111109. -SBI";
    const r = await ingest(sbiOut, ist("2026-11-27T11:05:00"));
    expect(r).toMatchObject({ channel: "UPI" });
    const { rows } = await pool.query("SELECT channel FROM transactions WHERE bank = 'ICICI'");
    expect(rows).toEqual([{ channel: "SALARY" }]);
  });

  it("does not pair two transactions on the same account", async () => {
    await ingest(iciciDebitTo("MR R K", "777.00", "600000000106"), ist("2026-11-20T14:00:00"));
    const sameAcctCredit = "ICICI Bank Account XX123 credited:Rs. 777.00 on 20-Nov-26. Info UPI-600000000107-MR R K.";
    expect(await ingest(sameAcctCredit, ist("2026-11-20T14:02:00"))).toMatchObject({ channel: "OTHER_IN" });
  });
});

describe("concurrency", () => {
  it("two different SMS for a new month → one bucket, both stored", async () => {
    const a = iciciDebitTo("SHOP A", "10.00", "600000000201");
    const b = iciciDebitTo("SHOP B", "20.00", "600000000202");
    const results = await Promise.all([ingest(a), ingest(b)]);
    expect(results.map((r) => r.status)).toEqual(["saved", "saved"]);
    expect(await count("month_buckets")).toBe(1);
    expect(await count("transactions")).toBe(2);
  });

  it("the same SMS in parallel → one transaction, the other is duplicate", async () => {
    const results = await Promise.all([ingest(ICICI_UPI), ingest(ICICI_UPI), ingest(ICICI_UPI)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(["duplicate", "duplicate", "saved"]);
    const savedId = (results.find((r) => r.status === "saved") as { id: string }).id;
    for (const r of results) expect((r as { id: string }).id).toBe(savedId);
    expect(await count("transactions")).toBe(1);
  });
});
