import type pg from "pg";
import { ensureBucket } from "./buckets";
import { type ClassifyConfig, classify } from "./sms/classify";
import { bucketMonthKey, transactionTime } from "./sms/month";
import { isNoise } from "./sms/noise";
import { normalizeSms, smsHash } from "./sms/normalize";
import { parseSms } from "./sms/parsers";
import { type Channel, type ClassifiedSms, SAVINGS_SOURCES } from "./sms/types";

export type IngestResult =
  | { status: "saved"; id: string; month: string; channel: Channel; needsNote: boolean }
  | { status: "duplicate"; id: string }
  | { status: "ignored" }
  | { status: "unrecognized" };

/** Self-transfer pairing window (spec: within 15 minutes). */
const PAIR_WINDOW_SECONDS = 15 * 60;
/** Arbitrary constant key that serializes self-transfer pairing. */
const PAIRING_LOCK_KEY = 727_274_001;

async function findExisting(client: pg.PoolClient, hash: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM transactions WHERE sms_hash = $1
     UNION ALL
     SELECT id FROM unparsed_sms WHERE sms_hash = $1
     LIMIT 1`,
    [hash],
  );
  return rows[0]?.id ?? null;
}

async function applyMerchantRule(
  client: pg.PoolClient,
  c: ClassifiedSms,
): Promise<{ needsNote: boolean; userNote: string | null }> {
  if (!c.needsNote || !c.counterparty) return { needsNote: c.needsNote, userNote: null };
  const { rows } = await client.query<{ default_note: string; skip_prompt: boolean }>(
    "SELECT default_note, skip_prompt FROM merchant_rules WHERE lower(merchant_vpa) = lower($1)",
    [c.counterparty],
  );
  const rule = rows[0];
  if (rule?.skip_prompt) return { needsNote: false, userNote: rule.default_note };
  return { needsNote: true, userNote: null };
}

/**
 * Pair an IN/OUT on different own savings accounts with the same amount
 * within 15 minutes; both become SELF_TRANSFER. Returns the new channel of
 * `txnId` if it was paired. Runs inside the caller's DB transaction.
 */
async function pairSelfTransfer(
  client: pg.PoolClient,
  txnId: string,
  c: ClassifiedSms,
  txnTime: Date,
): Promise<boolean> {
  if (!(SAVINGS_SOURCES as readonly string[]).includes(c.source)) return false;
  if (c.channel === "SALARY" || c.channel === "CARD_PAYMENT") return false;

  await client.query("SELECT pg_advisory_xact_lock($1)", [PAIRING_LOCK_KEY]);
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM transactions
     WHERE id <> $1
       AND transfer_pair_id IS NULL
       AND amount = $2
       AND txn_type = $3
       AND bank = ANY($4)
       AND account_ref IS DISTINCT FROM $5
       AND channel NOT IN ('SALARY', 'CARD_PAYMENT')
       AND abs(extract(epoch FROM transacted_at - $6::timestamptz)) <= $7
     ORDER BY abs(extract(epoch FROM transacted_at - $6::timestamptz))
     LIMIT 1
     FOR UPDATE`,
    [
      txnId,
      c.amount,
      c.direction === "OUT" ? "IN" : "OUT",
      SAVINGS_SOURCES,
      c.accountRef,
      txnTime.toISOString(),
      PAIR_WINDOW_SECONDS,
    ],
  );
  const match = rows[0];
  if (!match) return false;

  await client.query(
    `UPDATE transactions
     SET channel = 'SELF_TRANSFER', needs_note = false, transfer_pair_id = gen_random_uuid()
     WHERE id = $1`,
    [txnId],
  );
  await client.query(
    `UPDATE transactions
     SET channel = 'SELF_TRANSFER', needs_note = false,
         transfer_pair_id = (SELECT transfer_pair_id FROM transactions WHERE id = $1)
     WHERE id = $2`,
    [txnId, match.id],
  );
  return true;
}

/**
 * Full ingestion pipeline for one raw SMS (design D2). Never throws for
 * noise or unparseable input; throws only on storage failure.
 */
export async function ingestSms(
  pool: pg.Pool,
  rawSms: string,
  cfg: ClassifyConfig,
  receivedAt: Date = new Date(),
): Promise<IngestResult> {
  const sms = normalizeSms(rawSms);
  const hash = smsHash(rawSms);
  const client = await pool.connect();
  try {
    const existing = await findExisting(client, hash);
    if (existing) return { status: "duplicate", id: existing };

    if (isNoise(sms)) return { status: "ignored" };

    const parsed = parseSms(sms);
    if (!parsed) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO unparsed_sms (raw_sms, sms_hash, received_at) VALUES ($1, $2, $3)
         ON CONFLICT (sms_hash) DO NOTHING RETURNING id`,
        [sms, hash, receivedAt.toISOString()],
      );
      if (rows[0]) return { status: "unrecognized" };
      return { status: "duplicate", id: (await findExisting(client, hash))! };
    }

    const c = classify(parsed, sms, cfg);
    const txnTime = transactionTime(parsed.date, receivedAt);
    const month = bucketMonthKey(txnTime, c.channel);

    await client.query("BEGIN");
    try {
      const bucketId = await ensureBucket(client, month);
      const { needsNote, userNote } = await applyMerchantRule(client, c);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO transactions
           (bucket_id, txn_type, channel, amount, merchant_vpa, raw_sms, sms_hash,
            user_note, needs_note, transacted_at, bank, account_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (sms_hash) DO NOTHING
         RETURNING id`,
        [
          bucketId,
          c.direction,
          c.channel,
          c.amount,
          c.counterparty,
          sms,
          hash,
          userNote,
          needsNote,
          txnTime.toISOString(),
          c.source,
          c.accountRef,
        ],
      );
      const id = rows[0]?.id;
      if (!id) {
        // Lost a race with an identical SMS: keep nothing from this attempt.
        await client.query("ROLLBACK");
        return { status: "duplicate", id: (await findExisting(client, hash))! };
      }

      const paired = await pairSelfTransfer(client, id, c, txnTime);
      await client.query("COMMIT");
      return paired
        ? { status: "saved", id, month, channel: "SELF_TRANSFER", needsNote: false }
        : { status: "saved", id, month, channel: c.channel, needsNote };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  } finally {
    client.release();
  }
}
