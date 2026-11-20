-- migrate:up

-- Source bank/card and account suffix for every transaction.
ALTER TABLE transactions
  ADD COLUMN bank VARCHAR(12) NOT NULL DEFAULT 'UNKNOWN'
    CONSTRAINT transactions_bank_check
    CHECK (bank IN ('ICICI', 'SBI', 'UTKARSH', 'KOTAK', 'ICICI_CC', 'KOTAK_CC', 'ONECARD', 'UNKNOWN')),
  ADD COLUMN account_ref TEXT,
  -- Links the two halves of a detected self-transfer (internal).
  ADD COLUMN transfer_pair_id UUID;

-- Two new channels that are excluded from spending totals.
ALTER TABLE transactions DROP CONSTRAINT transactions_channel_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_channel_check
  CHECK (channel IN ('SALARY', 'OTHER_IN', 'EMI_AUTOPAY', 'UPI', 'CARD', 'CARD_PAYMENT', 'SELF_TRANSFER'));

CREATE INDEX idx_transactions_pairing ON transactions (amount, transacted_at)
  WHERE transfer_pair_id IS NULL;

-- SMS that were authenticated and not noise but could not be parsed.
CREATE TABLE unparsed_sms (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_sms     TEXT        NOT NULL,
  sms_hash    VARCHAR(64) NOT NULL UNIQUE CHECK (sms_hash ~ '^[0-9a-f]{64}$'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed    BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Same columns as before; CARD_PAYMENT and SELF_TRANSFER no longer move totals.
CREATE OR REPLACE VIEW bucket_balances AS
WITH totals AS (
  SELECT
    b.id                 AS bucket_id,
    b.month_key,
    b.label,
    b.opening_adjustment,
    COALESCE(SUM(t.amount) FILTER (
      WHERE t.txn_type = 'IN'  AND t.channel NOT IN ('CARD_PAYMENT', 'SELF_TRANSFER')), 0.00) AS money_in,
    COALESCE(SUM(t.amount) FILTER (
      WHERE t.txn_type = 'OUT' AND t.channel NOT IN ('CARD_PAYMENT', 'SELF_TRANSFER')), 0.00) AS money_out
  FROM month_buckets b
  LEFT JOIN transactions t ON t.bucket_id = b.id
  GROUP BY b.id
),
running AS (
  SELECT
    totals.*,
    SUM(opening_adjustment + money_in - money_out)
      OVER (ORDER BY month_key ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS closing_balance
  FROM totals
)
SELECT
  bucket_id,
  month_key,
  label,
  opening_adjustment,
  closing_balance - money_in + money_out AS opening_balance,
  money_in,
  money_out,
  closing_balance
FROM running;

-- migrate:down

CREATE OR REPLACE VIEW bucket_balances AS
WITH totals AS (
  SELECT
    b.id                 AS bucket_id,
    b.month_key,
    b.label,
    b.opening_adjustment,
    COALESCE(SUM(t.amount) FILTER (WHERE t.txn_type = 'IN'),  0.00) AS money_in,
    COALESCE(SUM(t.amount) FILTER (WHERE t.txn_type = 'OUT'), 0.00) AS money_out
  FROM month_buckets b
  LEFT JOIN transactions t ON t.bucket_id = b.id
  GROUP BY b.id
),
running AS (
  SELECT
    totals.*,
    SUM(opening_adjustment + money_in - money_out)
      OVER (ORDER BY month_key ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS closing_balance
  FROM totals
)
SELECT
  bucket_id,
  month_key,
  label,
  opening_adjustment,
  closing_balance - money_in + money_out AS opening_balance,
  money_in,
  money_out,
  closing_balance
FROM running;

DROP TABLE unparsed_sms;
DROP INDEX idx_transactions_pairing;

-- Fails if rows already use the new channels; migrate forward instead in that case.
ALTER TABLE transactions DROP CONSTRAINT transactions_channel_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_channel_check
  CHECK (channel IN ('SALARY', 'OTHER_IN', 'EMI_AUTOPAY', 'UPI', 'CARD'));

ALTER TABLE transactions
  DROP COLUMN transfer_pair_id,
  DROP COLUMN account_ref,
  DROP COLUMN bank;
