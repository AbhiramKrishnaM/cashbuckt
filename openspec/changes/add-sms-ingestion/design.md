# Design

## Context

`setup-infrastructure` provides the Next.js app (16.x, App Router, `cacheComponents` on), the shared `pg` pool (`src/lib/db.ts`), env validation (`src/lib/env.ts`, `REQUIRED_ENV`), dbmate migrations in `db/migrations/`, the `transactions` / `month_buckets` / `merchant_rules` tables, the `bucket_balances` view, and the vitest setup (unit tests plus integration tests against the dev Postgres on `127.0.0.1:55432`, each in a rolled-back transaction).

Motivation and scope are in proposal.md. Behavior is in `specs/sms-ingestion`, `specs/sms-parsing`, `specs/month-bucketing` and `specs/transaction-storage`.

Known inputs: the owner has 4 savings accounts (ICICI, SBI, Utkarsh, Kotak) and 3 credit cards (ICICI, Kotak, OneCard), with salary arriving in ICICI. Only two real SMS exist so far: an ICICI UPI debit and an IDFC FIRST EMI reminder. Every other format is representative until real samples arrive.

## Goals / Non-Goals

**Goals:**
- Parsing and classification are **pure functions** (SMS text + config + receive time → result), so nearly all rules are unit-tested without a database.
- A new bank format can be added as one parser module plus fixtures, without touching the pipeline.
- No SMS is silently lost: every authenticated request ends as saved, duplicate, ignored (noise), or unrecognized (kept).

**Non-Goals:**
- An NLP or LLM parser. Regex per bank is deterministic, testable and free.
- Re-processing stored `unparsed_sms` automatically when a parser is added. That's done manually (SQL / a later admin tool).

## Decisions

### D1. iPhone triggers: broad "Rs" + "INR" + "debited" automations instead of "debited"/"credited"
Card SMS say "spent", and Kotak says "Sent". SBI's UPI debit (`debited by 250.0`) has no currency marker at all. ICICI debits also contain "credited". So the blueprint's two-keyword setup would both miss SMS and double-send others.

Three automations catch essentially every money SMS: **Message contains "Rs"**, **"INR"**, and **"debited"** (for SBI's bare amounts). Server-side noise filtering and hash dedup absorb the extra traffic and the duplicates. Each Shortcut first checks **"If Shortcut Input contains OTP → Stop"**, so OTPs never leave the phone.
- *Alternative:* one automation per keyword (debited/credited/spent/sent). Rejected because it's more automations and still misses unknown wording.

### D2. Pipeline (`src/lib/ingest.ts`)
```
authenticate → read body (≤4 KB) → normalize → sha256
  → already in transactions or unparsed_sms? → "duplicate"
  → isNoise(sms)? → "ignored" (nothing stored)
  → parse(sms, now) → null? → insert unparsed_sms → "unrecognized"
  → classify(parsed, config) → resolveBucket(txnTime, channel)
  → DB txn: upsert bucket, insert transaction (ON CONFLICT sms_hash DO NOTHING),
            apply merchant rule, pair self-transfer
  → "saved"
```
Pure modules live in `src/lib/sms/`: `normalize.ts`, `noise.ts`, `amount.ts`, `date.ts`, `parsers/{icici,icici-cc,sbi,utkarsh,kotak,kotak-cc,onecard,generic}.ts`, `classify.ts`, and `month.ts`. DB-touching code is only in `ingest.ts` and `buckets.ts`.

### D3. Parser registry, with a strict generic fallback
Each parser exports `{ source, matches(sms): boolean, parse(sms): Parsed | null }`. The registry tries bank parsers in order. The first whose `matches` is true owns the SMS, and its `parse` result is final (null → unrecognized), so a half-matching bank SMS never falls through to a looser parser.

The `generic` parser runs only when no bank parser matches. It accepts an SMS only with exactly one direction verb tied to "your A/c / Card", plus one amount. Anything ambiguous, such as both "debited" and "credited", is unrecognized. This favors capturing for review over guessing wrong.

### D4. Direction by structure, not keywords
Bank parsers use anchored patterns, for example ICICI:
`^ICICI Bank Acct XX(\d+) debited for (?:Rs|INR)\.? ?([\d,]+(?:\.\d{1,2})?) on (\S+?); (.+?) credited\.`

The owner's account is the subject of "debited for", so the direction is OUT and the "… credited" party is the counterparty. That's how the "credited" inside ICICI debits is handled.

### D5. Money and dates
- Amounts are parsed with a regex into a decimal **string** (`"142000.00"`), with commas stripped and padded to 2 decimals. They never pass through `Number`, and go to Postgres as text into `NUMERIC(12,2)`.
- Dates are parsed by a small format table (`DD-MMM-YY`, `DDMMMYY`, `DD-MM-YY`, `DD-MM-YYYY`, `DD/MM/YYYY`). India has no DST, so IST is a fixed +05:30 offset, and month resolution is plain arithmetic on `Date` with no timezone library.

### D6. Classification order and config
`classify()` applies the channel precedence from the spec. Its config comes from env:
- `OWNER_NAME_PATTERNS`: comma list of names, matched case-insensitively on word boundaries.
- `OWN_CARD_SUFFIXES`: comma list such as `9001,4402,7788`, used to spot card-bill payments by number.
- `SALARY_MIN_AMOUNT`: default `100000`.

Card-payment counterparties are detected with a keyword list (`CREDIT CARD`, `CRED`, `ONECARD`, `BILLDESK CC`) kept in one exported constant so it's easy to extend.

### D7. Idempotency and buckets under concurrency
- One hash namespace across `transactions.sms_hash` and `unparsed_sms.sms_hash`. Both are checked before parsing, and the inserts use `ON CONFLICT (sms_hash) DO NOTHING RETURNING id`. If a racing insert wins, the code re-selects the existing id and returns "duplicate".
- Buckets use `INSERT … ON CONFLICT (month_key) DO NOTHING`, then `SELECT id`, in the same DB transaction.

### D8. Self-transfer pairing
After inserting an IN or OUT on a savings source, still inside the transaction, the code takes `pg_advisory_xact_lock(<constant>)`. That serializes pairing so a near-simultaneous debit and credit can't miss each other; at about 15 SMS/day the contention is negligible.

It then looks for the closest unpaired opposite-direction transaction with:
- the same amount
- a different savings `account_ref`
- `|Δt| ≤ 15 min`
- a channel other than `SALARY` or `CARD_PAYMENT`

When it finds one, both rows get `channel = 'SELF_TRANSFER'`, `needs_note = false`, and a shared `transfer_pair_id`. The `transfer_pair_id UUID` column is internal: it prevents double pairing and records the link.

**Downstream contract:** a debit can be re-classified up to 15 minutes after it's stored. `add-note-prompt` must delay each push about 2 minutes and re-check `needs_note` before sending. That covers the common case where both SMS land within seconds; rare slower pairs may still produce a prompt, which the owner can dismiss.

### D9. Migration `<ts>_sms_ingestion.sql`
- `transactions`:
  - add `bank VARCHAR(12) NOT NULL DEFAULT 'UNKNOWN'` with a CHECK on the 8 values
  - add `account_ref TEXT`
  - add `transfer_pair_id UUID`
  - replace the channel CHECK with the 7-value list
- New `unparsed_sms (id UUID PK, raw_sms TEXT NOT NULL, sms_hash VARCHAR(64) UNIQUE NOT NULL CHECK hex, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed BOOLEAN NOT NULL DEFAULT FALSE)`.
- `CREATE OR REPLACE VIEW bucket_balances`: the existing definition with `AND t.channel NOT IN ('CARD_PAYMENT','SELF_TRANSFER')` added to the IN/OUT `FILTER`s. Same columns, so the replace is valid.
- The down migration reverses all of it.

### D10. Webhook route
`src/app/api/log-transaction/route.ts` exports `POST` only.
- **Secret check:** both values are SHA-256 hashed and compared with `crypto.timingSafeEqual`, so lengths always match. `WEBHOOK_SECRET` is added to `REQUIRED_ENV`.
- **Size limit:** `Content-Length` is checked first, then the text length after reading, giving 413 above 4 KB.
- **Logging:** only `status`, channel and the first 8 hex characters of the hash. Raw SMS text is never logged.
- **Caching:** POST handlers aren't cached or prerendered, so `connection()` isn't needed.

### D11. Fixtures
`tests/fixtures/sms.ts` holds a typed table of `{ sms, confirmed: boolean, expected: {...} }`.
- `confirmed: true` marks masked real SMS. Today that's the ICICI UPI debit and the IDFC reminder.
- `confirmed: false` marks representative formats, flipped to true when a real sample replaces them.

Real unmasked samples go in the gitignored `sms-samples/`. The parser test suite is table-driven over this list.

## Risks / Trade-offs

- [Representative formats for SBI, Utkarsh, Kotak and the cards don't match the real SMS] → Unrecognized SMS are captured, not dropped. The first week after go-live includes a daily review of `unparsed_sms` (`docs/sms-review.md`), and each real SMS received becomes a confirmed fixture. A missed day is recoverable from the stored text.
- [The "Rs" trigger sends non-financial SMS containing "Rs" (offers, bills) to the server] → They're dropped as noise or land in `unparsed_sms`. Promotional senders can be blocked in the Shortcut later. OTPs are filtered on the phone.
- [False self-transfer pairing (paying someone ₹500 while a ₹500 refund arrives in another account)] → Both sides must be different savings accounts, the same amount, and within 15 minutes. That's rare, and the cost is just a missing note prompt.
- [ICICI changes its SMS wording] → The anchored regex fails, the SMS becomes unrecognized (visible) rather than misparsed (silent).
- [Spec ordering: this change modifies `transaction-storage`, which is only created when `setup-infrastructure` is archived] → Archive `setup-infrastructure` first. Implementation itself doesn't depend on that order.

## Migration Plan

1. Merge, then on the droplet: `git pull && docker compose up -d --build` (the migrate service applies the new migration).
2. Add `WEBHOOK_SECRET` (`openssl rand -hex 32`), `OWNER_NAME_PATTERNS`, `OWN_CARD_SUFFIXES` and `SALARY_MIN_AMOUNT` to `.env`. The app refuses to start without `WEBHOOK_SECRET`.
3. Smoke test from the laptop with `curl` using the fixture SMS (`docs/iphone-shortcuts.md`).
4. Set up the two iPhone automations. Check `unparsed_sms` daily during the first week, and add or adjust parsers for real formats.
5. **Rollback:** `git checkout <prev>` + rebuild. `dbmate rollback` is safe only before real rows use the new channels; otherwise use a forward fix.
