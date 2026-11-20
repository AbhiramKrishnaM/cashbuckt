# Spec Delta

## Purpose

Defines the persistent data model for CashBuckt's month buckets, transactions, push subscriptions, and merchant rules. The database itself enforces the integrity rules that keep balances and deduplication correct.

## ADDED Requirements

### Requirement: Month buckets
The system SHALL store one month bucket per calendar month, identified by a unique `month_key` in `YYYY-MM` format with a human label such as `December 2026`. The database SHALL reject a second bucket with an existing `month_key` and any `month_key` not matching `YYYY-MM` with month 01–12.

#### Scenario: Duplicate month rejected
- **WHEN** a bucket with `month_key = '2026-12'` exists and another insert with `month_key = '2026-12'` is attempted
- **THEN** the insert fails with a unique-constraint error and the existing bucket is unchanged

#### Scenario: Malformed key rejected
- **WHEN** a bucket insert uses `month_key = '2026-13'` or `'Dec-2026'`
- **THEN** the insert is rejected by a database constraint (format check or length limit)

### Requirement: Balances are derived, not stored
A bucket's opening balance, money in, money out, and closing balance SHALL be computed from transactions, so that a transaction added to month N after month N+1 exists changes month N+1's opening balance. No stored balance column SHALL be authoritative. Each bucket MAY carry a manual opening adjustment (default 0) to seed the starting bank balance or correct drift.

#### Scenario: Late debit in prior month
- **WHEN** bucket `2026-12` already exists (from an early salary credit) and a ₹500 OUT transaction is then recorded in bucket `2026-11`
- **THEN** the computed opening balance of `2026-12` is ₹500 lower than it was before that transaction

#### Scenario: Seeding the first month
- **WHEN** the first bucket `2026-11` has opening adjustment ₹20,000.00, IN total ₹0.00 and OUT total ₹3,000.00
- **THEN** `2026-11` shows opening ₹20,000.00 and closing ₹17,000.00, and `2026-12` (adjustment 0) opens at ₹17,000.00

### Requirement: Transaction records
Each transaction SHALL belong to exactly one bucket and SHALL record: type (`IN` or `OUT`), channel (`SALARY`, `OTHER_IN`, `EMI_AUTOPAY`, `UPI`, or `CARD`), a positive amount with two-decimal precision, the raw SMS text, a SHA-256 hash of the SMS, optional merchant/VPA, optional user note, optional AI cluster, a needs-note flag, and a timezone-aware transaction timestamp.

#### Scenario: Invalid type or channel rejected
- **WHEN** a transaction insert uses `txn_type = 'DEBIT'` or `channel = 'CASH'`
- **THEN** the insert fails with a check-constraint error

#### Scenario: Non-positive amount rejected
- **WHEN** a transaction insert uses `amount = 0` or `amount = -50.00`
- **THEN** the insert fails with a check-constraint error

#### Scenario: Exact money precision
- **WHEN** a transaction with amount `142000.00` and one with `2.50` are stored and summed
- **THEN** the sum is exactly `142002.50` with no floating-point error

### Requirement: Duplicate SMS prevention
The database SHALL reject a second transaction with an `sms_hash` already stored, so re-delivered or retried SMS cannot create duplicate transactions.

#### Scenario: Retry of same SMS
- **WHEN** a transaction with `sms_hash = 'ab12…'` exists and another insert with the same `sms_hash` is attempted
- **THEN** the insert fails with a unique-constraint error and only one transaction exists

### Requirement: Bucket deletion safety
A bucket that still has transactions SHALL NOT be deletable. This prevents a single mistaken delete from erasing a month of financial history.

#### Scenario: Delete non-empty bucket
- **WHEN** a delete is attempted on a bucket that has at least one transaction
- **THEN** the delete fails and both the bucket and its transactions remain

### Requirement: Push subscriptions and merchant rules storage
The system SHALL store Web Push subscriptions (endpoint unique, plus `p256dh` and `auth` keys) and merchant rules keyed by merchant/VPA (default note, skip-prompt flag).

#### Scenario: Duplicate push endpoint rejected
- **WHEN** a subscription with an existing endpoint is inserted
- **THEN** the insert fails with a unique-constraint error

### Requirement: Repeatable, versioned migrations
Schema changes SHALL be applied through ordered, versioned migration files. Applying migrations SHALL be idempotent: running them on an up-to-date database makes no changes, and running them on an empty database produces the full current schema.

#### Scenario: Fresh database
- **WHEN** migrations run against an empty database
- **THEN** all four tables, constraints, and indexes exist and the applied versions are recorded

#### Scenario: Re-run
- **WHEN** migrations run a second time with no new files
- **THEN** no schema changes occur and the command exits successfully
