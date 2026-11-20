-- migrate:up

-- Derived per-bucket balances. Nothing here is stored, so a late debit in
-- month N automatically lowers month N+1's opening balance.
--   net(b)     = opening_adjustment(b) + money_in(b) - money_out(b)
--   closing(N) = sum of net(b) for all b <= N   (month_key sorts as text: YYYY-MM)
--   opening(N) = closing(N) - money_in(N) + money_out(N)
--             = opening_adjustment(N) + sum of net(b) for all b < N
CREATE VIEW bucket_balances AS
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

-- migrate:down

DROP VIEW bucket_balances;
