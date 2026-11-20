-- migrate:up

-- 1. Month buckets: one per calendar month (YYYY-MM, Asia/Kolkata).
-- Balances are derived from transactions (see bucket_balances view);
-- opening_adjustment seeds the starting bank balance or corrects drift.
CREATE TABLE month_buckets (
  id                 SERIAL PRIMARY KEY,
  month_key          VARCHAR(7)     NOT NULL UNIQUE
                     CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  label              VARCHAR(32)    NOT NULL,
  opening_adjustment NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- 2. Individual transactions parsed from bank SMS.
CREATE TABLE transactions (
  id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: deleting a bucket must never silently erase its history.
  bucket_id     INT            NOT NULL REFERENCES month_buckets (id) ON DELETE RESTRICT,
  txn_type      VARCHAR(10)    NOT NULL CHECK (txn_type IN ('IN', 'OUT')),
  channel       VARCHAR(20)    NOT NULL
                CHECK (channel IN ('SALARY', 'OTHER_IN', 'EMI_AUTOPAY', 'UPI', 'CARD')),
  amount        NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  merchant_vpa  TEXT,
  raw_sms       TEXT           NOT NULL,
  sms_hash      VARCHAR(64)    NOT NULL UNIQUE CHECK (sms_hash ~ '^[0-9a-f]{64}$'),
  user_note     TEXT,
  ai_cluster    TEXT,
  needs_note    BOOLEAN        NOT NULL DEFAULT FALSE,
  transacted_at TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_bucket ON transactions (bucket_id, transacted_at DESC);

-- 3. iOS Web Push subscriptions.
CREATE TABLE push_subscriptions (
  id         SERIAL      PRIMARY KEY,
  endpoint   TEXT        NOT NULL UNIQUE,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Learned merchant auto-tag rules.
CREATE TABLE merchant_rules (
  merchant_vpa TEXT    PRIMARY KEY,
  default_note TEXT    NOT NULL,
  skip_prompt  BOOLEAN NOT NULL DEFAULT FALSE
);

-- migrate:down

DROP TABLE merchant_rules;
DROP TABLE push_subscriptions;
DROP TABLE transactions;
DROP TABLE month_buckets;
