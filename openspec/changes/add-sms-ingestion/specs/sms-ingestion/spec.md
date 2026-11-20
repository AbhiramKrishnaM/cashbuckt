# Spec Delta

## Purpose

The webhook the iPhone Shortcuts call with each bank SMS. It authenticates the caller, never stores the same SMS twice, drops noise quietly, keeps unparseable SMS for review, and always gives the Shortcut a fast, non-error answer.

## ADDED Requirements

### Requirement: Webhook authentication
`POST /api/log-transaction` SHALL require the header `X-Webhook-Secret` to equal the configured secret, compared in constant time. Requests with a missing or wrong secret SHALL receive 401 with no body detail, and nothing SHALL be stored or logged from the SMS.

#### Scenario: Missing secret
- **WHEN** a request arrives without `X-Webhook-Secret`
- **THEN** the response is 401 and no transaction, unparsed SMS, or log line containing the SMS text is written

#### Scenario: Wrong secret
- **WHEN** a request arrives with `X-Webhook-Secret: wrong`
- **THEN** the response is 401

### Requirement: Request format and limits
The body SHALL be JSON `{"sms": "<text>"}`. The response SHALL be 400 `{"error":"invalid_body"}` when the body is not JSON, `sms` is missing or not a string, or `sms` is empty after trimming. The response SHALL be 413 when the body exceeds 4 KB.

#### Scenario: Missing sms field
- **WHEN** an authenticated request has body `{"text":"hello"}`
- **THEN** the response is 400 `{"error":"invalid_body"}`

#### Scenario: Oversized body
- **WHEN** an authenticated request body is 10 KB
- **THEN** the response is 413 and nothing is stored

### Requirement: Saved transaction response
When an authenticated SMS is parsed into a transaction and stored, the response SHALL be 200 with `{"status":"saved","id":"<uuid>","month":"YYYY-MM","channel":"<CHANNEL>","needs_note":<bool>}`.

#### Scenario: ICICI UPI debit saved
- **WHEN** an authenticated request sends `ICICI Bank Acct XX123 debited for Rs 370.00 on 20-Nov-26; MOMO WANG credited. UPI:600000000001. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766`
- **THEN** the response is 200 with `status: "saved"`, `month: "2026-11"`, `channel: "UPI"`, `needs_note: true`

### Requirement: Idempotent ingestion
The system SHALL compute the SMS hash as SHA-256 of the SMS after trimming and collapsing runs of whitespace to a single space. If a transaction or unparsed SMS with that hash already exists, the response SHALL be 200 `{"status":"duplicate","id":"<existing id>"}` and nothing new SHALL be stored.

#### Scenario: Same SMS from two automations
- **WHEN** the ICICI SMS above is sent once by the "Rs" automation and again by the "debited" automation within one second
- **THEN** exactly one transaction exists, and the second response is `status: "duplicate"` with the first transaction's id

#### Scenario: Whitespace differences
- **WHEN** the same SMS is sent once with a trailing newline and once with two spaces after a semicolon
- **THEN** both produce the same hash and only one transaction is stored

### Requirement: Noise dropped without storing
SMS that are not completed money movements SHALL receive 200 `{"status":"ignored"}` and SHALL NOT be stored. Noise includes OTPs, payment reminders ("is due", "due on", "due tomorrow"), future debit notices ("will be debited"), UPI collect requests ("has requested"), declined or failed transactions, and promotional or marketing messages.

#### Scenario: Loan EMI reminder
- **WHEN** an authenticated request sends `Your Personal loan EMI is due tomorrow. Maintain Rs.2,924.00 in your registered bank A/c. today https://idfcft.bank.in/IDFCFB/kP57XM IDFC FIRST Bank.TCA`
- **THEN** the response is 200 `{"status":"ignored"}` and nothing is stored

#### Scenario: OTP
- **WHEN** an authenticated request sends `123456 is the OTP for transaction of INR 1,250.00 on your ICICI Bank Credit Card XX9001. Do not share it with anyone.`
- **THEN** the response is 200 `{"status":"ignored"}` and nothing is stored

#### Scenario: Declined card transaction
- **WHEN** an authenticated request sends `Transaction of Rs.899.00 on Kotak Credit Card XX4402 has been declined due to insufficient limit.`
- **THEN** the response is 200 `{"status":"ignored"}`

### Requirement: Unrecognized SMS captured for review
An authenticated SMS that is not noise but cannot be parsed into a transaction (no amount, or no clear direction) SHALL be stored in an unparsed-SMS store with its raw text, hash, and receive time. The response SHALL be 200 `{"status":"unrecognized"}`. It SHALL NOT create a transaction or bucket.

#### Scenario: Unknown bank format
- **WHEN** an authenticated request sends `Dear Customer, Rs 5,000.00 has been processed for A/c **4410 via ABC-NET ref 99887766.`
- **THEN** the response is 200 `{"status":"unrecognized"}`, one unparsed SMS row exists with that text, and no transaction is created

#### Scenario: Re-sent unrecognized SMS
- **WHEN** the same unrecognized SMS is sent twice
- **THEN** only one unparsed SMS row exists and the second response is `status: "duplicate"`

### Requirement: Fast response
The endpoint SHALL respond within 2 seconds under normal conditions, so iOS Shortcuts automations complete without timing out. If storage fails, the response SHALL be 500 `{"error":"storage_failed"}`, with no SMS text or connection details in the body, so the Shortcut can be re-run.

#### Scenario: Database down
- **WHEN** the database is unreachable and an authenticated SMS arrives
- **THEN** the response is 500 `{"error":"storage_failed"}` within 3 seconds
