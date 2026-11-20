# Spec Delta

## Purpose

Decides which month bucket every transaction belongs to: calendar months in Asia/Kolkata, with salary received late in a month counted toward the next one. Buckets are created automatically and safely the first time a month is needed.

## ADDED Requirements

### Requirement: IST calendar month
A transaction's bucket SHALL be the `YYYY-MM` of its transaction time in Asia/Kolkata, except for salary carryover. Times near midnight SHALL be judged in IST, not UTC.

#### Scenario: Just after midnight IST on the 1st
- **WHEN** a UPI debit has transaction time 2026-12-01 00:10 IST (2026-11-30 18:40 UTC)
- **THEN** it goes into bucket `2026-12`

#### Scenario: Last evening of the month
- **WHEN** a UPI debit has transaction time 2026-11-30 23:50 IST
- **THEN** it goes into bucket `2026-11`

### Requirement: Salary carryover (25th–31st)
A `SALARY` transaction whose IST transaction date is on the 25th through the last day of month N SHALL go into month N+1's bucket. Salary on the 1st–24th SHALL stay in its own month. December carries into January of the next year.

#### Scenario: Salary on Nov 27
- **WHEN** the ICICI salary credit `ICICI Bank Account XX123 credited:Rs. 1,42,000.00 on 27-Nov-26. Info NEFT-CITIN26331XXXXXX-ACME TECH PVT LTD. Available Balance is Rs. 1,62,000.00.` is ingested on 2026-11-27
- **THEN** it goes into bucket `2026-12`, and bucket `2026-12` is created if it did not exist

#### Scenario: Salary on Dec 26 rolls into the next year
- **WHEN** a `SALARY` credit is dated 2026-12-26
- **THEN** it goes into bucket `2027-01`

#### Scenario: Early salary stays put
- **WHEN** a `SALARY` credit is dated 2026-12-03
- **THEN** it goes into bucket `2026-12`

#### Scenario: Other large credits are not carried over
- **WHEN** an `OTHER_IN` credit of ₹1,50,000 is dated 2026-11-27
- **THEN** it goes into bucket `2026-11`

### Requirement: Transaction time from SMS date
When the SMS date equals the receive date in IST, the transaction time SHALL be the receive time. When the SMS date is earlier (a late re-send), the transaction time SHALL be 12:00 IST on the SMS date. An SMS date more than one day after the receive date SHALL be treated as a parse error, and the receive time used.

#### Scenario: Re-sent next month
- **WHEN** an SMS dated `30-Nov-26` is first received on 2026-12-02
- **THEN** its transaction time is 2026-11-30 12:00 IST and it goes into bucket `2026-11`

#### Scenario: Implausible future date
- **WHEN** an SMS dated `30-Dec-26` is received on 2026-11-20
- **THEN** its transaction time is the receive time and it goes into bucket `2026-11`

### Requirement: Automatic bucket creation
If the target bucket does not exist, it SHALL be created with `month_key`, an English label such as `December 2026`, and opening adjustment 0 before the transaction is stored. Concurrent requests for the same new month SHALL result in exactly one bucket and both transactions stored in it.

#### Scenario: Two SMS for a new month at once
- **WHEN** two different SMS for a month with no bucket are ingested concurrently
- **THEN** exactly one bucket exists for that month and both transactions reference it
