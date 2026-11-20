# Spec Delta

## MODIFIED Requirements

### Requirement: Balances are derived, not stored
A bucket's opening balance, money in, money out, and closing balance SHALL be computed from transactions, so that a transaction added to month N after month N+1 exists changes month N+1's opening balance. No stored balance column SHALL be authoritative. Each bucket MAY carry a manual opening adjustment (default 0) to seed the starting bank balance or correct drift. Transactions in channels `CARD_PAYMENT` and `SELF_TRANSFER` SHALL be excluded from money in, money out, and all balances.

#### Scenario: Late debit in prior month
- **WHEN** bucket `2026-12` already exists (from an early salary credit) and a ₹500 OUT transaction is then recorded in bucket `2026-11`
- **THEN** the computed opening balance of `2026-12` is ₹500 lower than it was before that transaction

#### Scenario: Seeding the first month
- **WHEN** the first bucket `2026-11` has opening adjustment ₹20,000.00, IN total ₹0.00 and OUT total ₹3,000.00
- **THEN** `2026-11` shows opening ₹20,000.00 and closing ₹17,000.00, and `2026-12` (adjustment 0) opens at ₹17,000.00

#### Scenario: Transfers and card-bill payments do not move totals
- **WHEN** bucket `2026-11` has a ₹899.00 `CARD` OUT, a ₹899.00 `CARD_PAYMENT` OUT, a ₹899.00 `CARD_PAYMENT` IN, and a ₹10,000.00 `SELF_TRANSFER` OUT with its matching `SELF_TRANSFER` IN
- **THEN** money out for `2026-11` is ₹899.00 and money in is ₹0.00

### Requirement: Transaction records
Each transaction SHALL belong to exactly one bucket and SHALL record: type (`IN` or `OUT`), channel (`SALARY`, `OTHER_IN`, `EMI_AUTOPAY`, `UPI`, `CARD`, `CARD_PAYMENT`, or `SELF_TRANSFER`), a positive amount with two-decimal precision, the raw SMS text, a SHA-256 hash of the SMS, the source bank or card (`ICICI`, `SBI`, `UTKARSH`, `KOTAK`, `ICICI_CC`, `KOTAK_CC`, `ONECARD`, or `UNKNOWN`), an optional account reference, optional merchant/VPA, optional user note, optional AI cluster, a needs-note flag, and a timezone-aware transaction timestamp.

#### Scenario: Invalid type or channel rejected
- **WHEN** a transaction insert uses `txn_type = 'DEBIT'` or `channel = 'CASH'`
- **THEN** the insert fails with a check-constraint error

#### Scenario: Invalid bank rejected
- **WHEN** a transaction insert uses `bank = 'HDFC'`
- **THEN** the insert fails with a check-constraint error

#### Scenario: Non-positive amount rejected
- **WHEN** a transaction insert uses `amount = 0` or `amount = -50.00`
- **THEN** the insert fails with a check-constraint error

#### Scenario: Exact money precision
- **WHEN** a transaction with amount `142000.00` and one with `2.50` are stored and summed
- **THEN** the sum is exactly `142002.50` with no floating-point error

## ADDED Requirements

### Requirement: Unrecognized SMS storage
The system SHALL store SMS that could not be parsed, with raw text, a unique SHA-256 hash, receive time, and a reviewed flag (default false). These SMS SHALL NOT affect any bucket or balance.

#### Scenario: Duplicate unparsed SMS rejected
- **WHEN** an unparsed SMS with an existing hash is inserted
- **THEN** the insert fails with a unique-constraint error

#### Scenario: No effect on balances
- **WHEN** an unparsed SMS containing `Rs 5,000.00` is stored
- **THEN** every bucket's money in, money out, and balances are unchanged
