# Tasks

## 1. Schema

- [x] 1.1 Write migration `<ts>_sms_ingestion.sql` per design D9 (add `bank` + CHECK, `account_ref`, `transfer_pair_id`; widen channel CHECK to 7 values; create `unparsed_sms`; `CREATE OR REPLACE VIEW bucket_balances` excluding `CARD_PAYMENT`/`SELF_TRANSFER`; full `migrate:down`); verify `dbmate up`, `rollback`, `up` all succeed on the dev DB
- [x] 1.2 Extend integration tests: `bank = 'HDFC'` rejected, new channels accepted, duplicate `unparsed_sms.sms_hash` rejected, the "transfers and card-bill payments do not move totals" scenario, and unparsed SMS leaving balances unchanged; verify all existing and new `npm test` tests pass

## 2. SMS primitives (pure)

- [x] 2.1 Implement `src/lib/sms/normalize.ts` (trim, collapse whitespace, sha256 hex); verify unit tests prove the trailing-newline and double-space variants of the ICICI SMS hash identically
- [x] 2.2 Implement `src/lib/sms/amount.ts` (Rs / Rs. / INR / ₹ / bare `debited by`, Indian and Western grouping, 0–2 decimals → 2-decimal string; skip balance/limit amounts); verify unit tests for `1,42,000.00`, `250.0`, `Rs. 650`, and the card SMS with `Avl Limit`
- [x] 2.3 Implement `src/lib/sms/date.ts` (DD-MMM-YY, DDMMMYY, DD-MM-YY, DD-MM-YYYY, DD/MM/YYYY → IST date); verify unit tests for each format plus an invalid date (`31-Feb-26`) returning null
- [x] 2.4 Implement `src/lib/sms/noise.ts`; verify unit tests: the IDFC "EMI is due tomorrow" SMS, the OTP SMS, the declined Kotak card SMS, a "will be debited" notice, and a "has requested money" collect request are noise, while every transaction fixture is not

## 3. Bank parsers & fixtures

- [x] 3.1 Create `tests/fixtures/sms.ts` (typed `{sms, confirmed, expected}` table) with every SMS string from the specs, marking the ICICI UPI debit and the IDFC reminder `confirmed: true` and all others `confirmed: false`; verify it type-checks
- [x] 3.2 Implement the parser registry and `parsers/icici.ts` (savings: UPI debit with "…credited" counterparty, NEFT credit, ACH-DR debit); verify the table-driven parser test passes for all ICICI savings fixtures, including direction OUT for the MOMO WANG SMS
- [x] 3.3 Implement `parsers/sbi.ts` and `parsers/utkarsh.ts`; verify the fixture tests pass for SBI debit (`debited by 250.0`), SBI credit, SBI large NEFT credit, and the Utkarsh debit
- [x] 3.4 Implement `parsers/kotak.ts` (savings "Sent …") and `parsers/kotak-cc.ts` (spend, refund); verify the fixture tests pass
- [x] 3.5 Implement `parsers/icici-cc.ts` (spend, payment received) and `parsers/onecard.ts`; verify the fixture tests pass, including source `ICICI_CC` vs `ICICI` and account refs
- [x] 3.6 Implement the strict `parsers/generic.ts` fallback (D3); verify unit tests: the unknown "processed for A/c **4410" SMS → null, an SMS with both "debited" and "credited" and no bank match → null, and a simple "Rs 100 debited from your A/c XX99" → parsed

## 4. Classification

- [x] 4.1 Implement `src/lib/sms/classify.ts` with the channel precedence, card-payment keywords and `OWN_CARD_SUFFIXES`, the owner-name match, salary detection (ICICI + NEFT + ≥ `SALARY_MIN_AMOUNT`), and the `needs_note` rule; verify the unit tests cover every channel scenario in `specs/sms-parsing`: EMI, card spend, OneCard, card refund, ICICI salary, SBI large credit not salary, CRED payment, card payment received, owner-name self-transfer

## 5. Month resolution

- [x] 5.1 Implement `src/lib/sms/month.ts` (transaction time from SMS date vs receive time, IST month key, salary carryover incl. Dec→Jan, label `December 2026`); verify unit tests cover every `specs/month-bucketing` scenario except concurrency: 00:10 IST on Dec 1, 23:50 Nov 30, salary Nov 27 → 2026-12, Dec 26 → 2027-01, Dec 3 stays, OTHER_IN Nov 27 stays, re-send Dec 2 of a Nov 30 SMS → 2026-11, future date → receive time

## 6. Ingestion pipeline (DB)

- [x] 6.1 Implement `src/lib/buckets.ts` (`ensureBucket` via ON CONFLICT) and `src/lib/ingest.ts` (D2 flow: dedupe across both tables, noise, parse, classify, bucket, insert, merchant rule, unparsed capture); verify integration tests for saved / duplicate / ignored / unrecognized results and the merchant-rule skip-prompt scenario
- [x] 6.2 Implement self-transfer pairing (advisory lock, closest unpaired match within 15 min on a different savings account, sets `SELF_TRANSFER`, `needs_note=false`, `transfer_pair_id`); verify integration tests: the 3-minute pair is reclassified, the 40-minute pair is not, and SALARY is never paired
- [x] 6.3 Verify concurrency with an integration test: two different SMS for a new month ingested in parallel → one bucket, both transactions stored; the same SMS ingested in parallel → one transaction, other result `duplicate`

## 7. Webhook route

- [x] 7.1 Add `WEBHOOK_SECRET` to `REQUIRED_ENV`; add `WEBHOOK_SECRET`, `OWNER_NAME_PATTERNS`, `OWN_CARD_SUFFIXES`, `SALARY_MIN_AMOUNT` to `.env.example` and the local `.env`; implement config parsing with defaults; verify unit tests for parsing comma lists and the salary default
- [x] 7.2 Implement `src/app/api/log-transaction/route.ts` (constant-time secret check, 4 KB limit, JSON validation, status mapping, 500 `storage_failed`, hash-prefix-only logging); verify route tests for 401 missing/wrong secret (nothing stored), 400 invalid body, 413 oversized, 200 saved for the ICICI SMS with `month: "2026-11"`, `channel: "UPI"`, `needs_note: true`, and 500 with the DB unreachable
- [x] 7.3 Verify end to end on the local Docker stack: `curl -k https://localhost/api/log-transaction` with the fixture SMS returns saved, then duplicate on re-send, then ignored for the IDFC reminder; `bucket_balances` shows the debit; `npm run build` succeeds

## 8. Docs

- [x] 8.1 Write `docs/iphone-shortcuts.md` (three automations "Rs", "INR", "debited"; OTP-stop guard; Get Contents of URL with header and `{"sms": Shortcut Input}`; Run Immediately / no confirmation; curl smoke test); verify the curl command in it works against the local stack
- [x] 8.2 Write `docs/sms-review.md` (SQL to list unreviewed `unparsed_sms`, mark reviewed, and steps to add a parser and fixture from a real SMS); verify each SQL statement runs on the dev DB

## 9. Real formats & go-live (owner + me)

- [ ] 9.1 Owner provides at least one masked real SMS for each of: ICICI NEFT salary, ICICI ACH/EMI debit, SBI UPI debit, SBI credit, Utkarsh debit, Kotak savings debit, ICICI card spend, Kotak card spend, OneCard spend, and a card payment received; replace the representative fixtures, set `confirmed: true`, adjust parsers until all tests pass
- [ ] 9.2 Deploy to the droplet (requires `setup-infrastructure` tasks 6.2–6.3), set the new env vars, and run the curl smoke test against `https://<DOMAIN>`; verify `saved` and `duplicate` responses
- [ ] 9.3 Set up the three iPhone automations per `docs/iphone-shortcuts.md`; make one real ₹1–10 UPI payment; verify it appears with `channel = 'UPI'` and `needs_note = true`, and that any non-transaction SMS lands in `ignored` or `unparsed_sms`
- [ ] 9.4 Go-live check on the salary: when the Nov 26–29 ICICI salary arrives, verify it is stored as `SALARY` in bucket `2026-12` and that bucket `2026-12` was auto-created

## Workflow follow-up

- Archive `setup-infrastructure` before archiving this change. This change's `transaction-storage` delta uses MODIFIED, which needs that spec to exist.
- Archive this change with `/opsx:archive` after 9.4 passes.
- Next change: `add-note-prompt`, which must delay pushes by about 2 minutes and re-check `needs_note` (design D8).
