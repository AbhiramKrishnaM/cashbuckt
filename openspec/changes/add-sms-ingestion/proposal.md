# Proposal

## Why

CashBuckt can't record anything yet: there is no way for bank SMS to reach it. The owner's money moves through four savings accounts (ICICI, SBI, Utkarsh, Kotak) and three credit cards (ICICI, Kotak, OneCard), and every one of them sends SMS with different wording. The ingestion endpoint has to be live before the ICICI salary credit on Nov 26–29, 2026 so that it creates the `2026-12` bucket correctly. Every later feature (note prompts, dashboard, AI audit) reads the data this change produces.

## What Changes

- New `POST /api/log-transaction` webhook for the iOS Shortcuts automations, authenticated with the `X-Webhook-Secret` header. It always answers 200 for well-formed authenticated requests (saved / duplicate / ignored / unrecognized), so Shortcuts never show errors for noise.
- Idempotent ingestion: the SMS is normalized (whitespace) and SHA-256 hashed. Re-sends and the same SMS firing two automations are stored once.
- Noise filter: OTPs, "due tomorrow / due on" reminders, "will be debited" notices, collect requests, declined/failed transactions, and promotional links are dropped without storing.
- Per-bank SMS parsers (ICICI, SBI, Utkarsh, Kotak, ICICI/Kotak/OneCard credit cards) plus a generic fallback. They extract direction, amount (including Indian digit grouping such as `1,42,000.00`), counterparty, account/card suffix, and date. The ICICI savings format comes from a real sample. The other formats start from representative patterns and are confirmed from real SMS captured during the first week after go-live.
- **Debit/credit disambiguation:** ICICI debit SMS also contain the word "credited" (`…debited for Rs 370.00…; MOMO WANG credited.`). Direction is decided by which party the account is, not by keyword presence.
- Classification into channels: `SALARY`, `OTHER_IN`, `EMI_AUTOPAY`, `UPI`, `CARD`, plus two new excluded channels:
  - `CARD_PAYMENT`: paying a credit-card bill from savings, and the card's "payment received" SMS. Excluded from Money In/Out because the card swipes were already counted.
  - `SELF_TRANSFER`: money moved between the owner's own accounts, detected by owner-name match or a matching opposite-direction amount on another own account within 15 minutes. Excluded from Money In/Out.
- Salary detection is restricted to ICICI savings credits by NEFT with amount ≥ a configurable threshold (default ₹1,00,000). Salary arriving on the 25th–31st goes into the next month's bucket.
- Month bucket resolution in IST, with automatic bucket creation that is safe under concurrent requests.
- Transaction time comes from the date in the SMS when it differs from the receive date, so late re-sends land in the right month.
- `needs_note = true` only for manual `UPI` and `CARD` debits, unless a merchant rule auto-fills the note.
- **Unrecognized-SMS capture:** an authenticated SMS that isn't noise but can't be parsed is kept in a review table, not dropped. Real formats for the banks without samples are collected this way.
- Schema migration: `bank` and `account_ref` columns on transactions, two new channels, `unparsed_sms` table, and an updated `bucket_balances` view that excludes the two transfer channels.
- Shortcut setup doc (`docs/iphone-shortcuts.md`) with the trigger keywords and request format.

## Capabilities

### New Capabilities
- `sms-ingestion`: The webhook contract: authentication, request/response format, size limits, idempotency, noise dropping, and unrecognized-SMS capture.
- `sms-parsing`: Turning one raw bank SMS into a classified transaction: direction, amount, counterparty, account, date, bank, and channel, including card-bill and self-transfer detection and salary detection.
- `month-bucketing`: Assigning a transaction to a month bucket: IST month resolution, the 25th–31st salary carryover, SMS-date handling, and automatic bucket creation.

### Modified Capabilities
- `transaction-storage` (introduced by the in-flight `setup-infrastructure` change, which must be archived first):
  - Transactions also record the bank and account/card suffix.
  - The channel list gains `CARD_PAYMENT` and `SELF_TRANSFER`.
  - Derived balances exclude those two channels.
  - Adds unrecognized-SMS storage.

## Out of Scope

- Sending Web Push notifications, the service worker, and `/note/[id]` (change `add-note-prompt`). This change only sets `needs_note`.
- Any UI: dashboard, admin review screen for unparsed SMS, or editing transactions. Unparsed SMS are reviewed with SQL until the admin portal exists.
- Parsing available balance ("Avl Bal") for reconciliation.
- Banks or cards beyond the seven listed, and non-SMS sources (email alerts, statement upload, account aggregator APIs).
- Re-classifying past transactions when parser rules change. Fixes apply to new SMS only.
- Loan accounts as entities. IDFC FIRST EMI reminders are noise, and the actual EMI auto-debit is recorded from the savings account that pays it.

## Impact

- **New code:** `src/app/api/log-transaction/route.ts`, `src/lib/sms/` (normalize, noise, per-bank parsers, classify, self-transfer matcher), `src/lib/buckets.ts`, `src/lib/ingest.ts`, SMS fixtures under `tests/fixtures/sms/`, and the unit and integration tests.
- **Database:** new migration (columns, channel CHECK update, `unparsed_sms`, view replacement). Existing rows are unaffected (there are none in production yet).
- **Config:** `WEBHOOK_SECRET` becomes required. New `OWNER_NAME_PATTERNS` (names that mean "me" in a counterparty field) and `SALARY_MIN_AMOUNT`.
- **Downstream:** `add-note-prompt` must wait about 2 minutes before notifying, because a debit can be re-classified as `SELF_TRANSFER` when the matching credit arrives.
- **iPhone:** the Shortcuts automations change from the blueprint's "debited"/"credited" triggers to broader "Rs" / "INR" / "debited" triggers (see design.md D1).
