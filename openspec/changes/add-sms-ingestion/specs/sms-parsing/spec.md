# Spec Delta

## Purpose

Turns one raw Indian bank or credit-card SMS into a classified transaction (direction, amount, counterparty, bank, account, date, channel) for the owner's ICICI, SBI, Utkarsh and Kotak savings accounts and ICICI, Kotak and OneCard credit cards. Card-bill payments and self-transfers are kept out of spending totals.

## ADDED Requirements

### Requirement: Amount extraction
The parser SHALL extract the transaction amount as an exact two-decimal value from `Rs`, `Rs.`, `INR`, `₹` or bare `debited by`/`credited by` amounts, accepting Indian digit grouping (`1,42,000.00`), Western grouping (`142,000.00`), no grouping, and zero to two decimals. Other amounts in the SMS (available balance, available limit) SHALL NOT be taken as the transaction amount.

#### Scenario: Indian grouping with balance present
- **WHEN** parsing `ICICI Bank Account XX123 credited:Rs. 1,42,000.00 on 27-Nov-26. Info NEFT-CITIN26331XXXXXX-ACME TECH PVT LTD. Available Balance is Rs. 1,62,000.00.`
- **THEN** the amount is `142000.00`, not `162000.00`

#### Scenario: Bare amount, one decimal
- **WHEN** parsing `Dear UPI user A/C X1234 debited by 250.0 on date 20Nov26 trf to SWIGGY Refno 600000000002. If not u? call 1800111109. -SBI`
- **THEN** the amount is `250.00`

#### Scenario: Card spend with available limit
- **WHEN** parsing `INR 1,250.00 spent using ICICI Bank Card XX9001 on 20-Nov-26 on AMAZON PAY. Avl Limit: INR 1,00,000.00. If not you, call 1800 2662/SMS BLOCK 9001 to 9215676766.`
- **THEN** the amount is `1250.00`

### Requirement: Direction from the owner's account role
Direction SHALL be decided by what happened to the owner's account or card, not by which keywords appear. An SMS where the owner's account is debited, or money is sent or spent from it, is `OUT`, even if it also says the counterparty was "credited". An SMS where the owner's account is credited is `IN`.

#### Scenario: ICICI debit that mentions "credited"
- **WHEN** parsing `ICICI Bank Acct XX123 debited for Rs 370.00 on 20-Nov-26; MOMO WANG credited. UPI:600000000001. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766`
- **THEN** the direction is `OUT` and the counterparty is `MOMO WANG`

#### Scenario: SBI credit
- **WHEN** parsing `Dear SBI User, your A/c X1234-credited by Rs.1500 on 20Nov26 transfer from RAHUL K Ref No 600000000003 -SBI`
- **THEN** the direction is `IN`, the amount is `1500.00`, and the counterparty is `RAHUL K`

#### Scenario: Kotak "Sent"
- **WHEN** parsing `Sent Rs.1,200.00 from Kotak Bank AC X9012 to swiggy@icici on 20-11-26.UPI Ref 600000000005. Not you, https://kotak.com/KBANKT/Fraud`
- **THEN** the direction is `OUT` and the counterparty is `swiggy@icici`

### Requirement: Bank and account identification
The parser SHALL identify the source as one of `ICICI`, `SBI`, `UTKARSH`, `KOTAK` (savings) or `ICICI_CC`, `KOTAK_CC`, `ONECARD` (credit cards), and SHALL record an account reference made of the source and the last digits shown, such as `ICICI XX123` or `KOTAK_CC XX4402`.

#### Scenario: ICICI savings vs ICICI card
- **WHEN** the ICICI UPI debit and the ICICI card spend above are parsed
- **THEN** their sources are `ICICI` (account ref `ICICI XX123`) and `ICICI_CC` (account ref `ICICI_CC XX9001`)

#### Scenario: Utkarsh
- **WHEN** parsing `Rs.500.00 debited from your Utkarsh SFB A/c XX5678 on 20-11-2026 via UPI to zomato@hdfcbank. Ref 600000000004`
- **THEN** the source is `UTKARSH`, the account ref is `UTKARSH XX5678`, and the counterparty is `zomato@hdfcbank`

### Requirement: Transaction date
The parser SHALL extract the transaction date when present in formats such as `20-Nov-26`, `20Nov26`, `20-11-26`, `20-11-2026` and `20/11/2026`, interpreted in Asia/Kolkata. An SMS without a date SHALL use the receive time.

#### Scenario: Compact SBI date
- **WHEN** the SBI debit with `on date 20Nov26` is parsed
- **THEN** the transaction date is 2026-11-20 (IST)

### Requirement: Channel classification
Each parsed transaction SHALL get exactly one channel, checked in this order: `CARD_PAYMENT`, `SELF_TRANSFER` (owner-name match), `SALARY`, `EMI_AUTOPAY`, `CARD`, `UPI`, then `OTHER_IN` for remaining credits. A savings debit matching none of these SHALL be `UPI`.

#### Scenario: EMI auto-debit
- **WHEN** parsing `ICICI Bank Acct XX123 is debited with INR 2,924.00 on 05-Dec-26 towards ACH-DR IDFC FIRST BANK LTD.`
- **THEN** the channel is `EMI_AUTOPAY`, the direction is `OUT`, and `needs_note` is false

#### Scenario: Credit card spend
- **WHEN** parsing `Rs.899.00 spent on Kotak Credit Card XX4402 at AMAZON on 20/11/2026. Avl limit Rs.50,000.00`
- **THEN** the channel is `CARD`, the direction is `OUT`, the counterparty is `AMAZON`, and `needs_note` is true

#### Scenario: OneCard spend
- **WHEN** parsing `You've spent Rs. 650 at ZOMATO on your OneCard credit card ending 7788.`
- **THEN** the source is `ONECARD`, the channel is `CARD`, and the amount is `650.00`

#### Scenario: Refund to a card
- **WHEN** parsing `Refund of Rs 899.00 credited to your Kotak Credit Card XX4402 from AMAZON on 22/11/2026.`
- **THEN** the channel is `OTHER_IN` and the direction is `IN`

### Requirement: Salary detection
A credit SHALL be classified `SALARY` only when the source is `ICICI` savings, the SMS indicates NEFT, and the amount is at least the configured salary minimum (default ₹1,00,000.00). Large credits to any other account SHALL be `OTHER_IN`.

#### Scenario: ICICI salary
- **WHEN** the ICICI NEFT credit of `1,42,000.00` above is parsed
- **THEN** the channel is `SALARY` and `needs_note` is false

#### Scenario: Large credit elsewhere is not salary
- **WHEN** parsing `Dear SBI User, your A/c X1234-credited by Rs.150000 on 27Nov26 transfer from NEFT ACME TECH PVT LTD Ref No 600000000007 -SBI`
- **THEN** the channel is `OTHER_IN`

### Requirement: Credit-card bill payments excluded from spending
A savings debit whose counterparty is a credit card or card-payment service (counterparty containing `CREDIT CARD`, `CRED`, `ONECARD`, `BILLDESK CC`, or a card number of one of the owner's cards), and a card's "payment received" SMS, SHALL be classified `CARD_PAYMENT` with `needs_note` false.

#### Scenario: Paying the card bill via CRED
- **WHEN** parsing `ICICI Bank Acct XX123 debited for Rs 5,000.00 on 20-Nov-26; CRED Club credited. UPI:600000000006. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766`
- **THEN** the channel is `CARD_PAYMENT`, the direction is `OUT`, and `needs_note` is false

#### Scenario: Card confirms payment received
- **WHEN** parsing `Payment of INR 5,000.00 has been received on your ICICI Bank Credit Card Account XX9001 on 20-Nov-26.`
- **THEN** the channel is `CARD_PAYMENT` and the direction is `IN`

### Requirement: Self-transfer by owner name
A transaction whose counterparty matches one of the configured owner-name patterns (case-insensitive, whole words) SHALL be classified `SELF_TRANSFER` with `needs_note` false.

#### Scenario: Transfer to own SBI account
- **WHEN** owner-name patterns are `RAVI KUMAR,RAVI K` and parsing `ICICI Bank Acct XX123 debited for Rs 10,000.00 on 20-Nov-26; RAVI KUMAR credited. UPI:600000000008. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766`
- **THEN** the channel is `SELF_TRANSFER` and `needs_note` is false

### Requirement: Self-transfer by matching pair
When an `IN` and an `OUT` transaction have the same amount, are on different savings accounts of the owner, are within 15 minutes of each other, and neither is `SALARY`, `CARD_PAYMENT` or already paired, both SHALL be re-classified `SELF_TRANSFER` with `needs_note` false. If several candidates qualify, the closest in time SHALL be paired.

#### Scenario: Debit then matching credit
- **WHEN** an ICICI `OUT` of `10,000.00` to counterparty `MR R K` (channel `UPI`, `needs_note` true) is stored, and 3 minutes later an SBI `IN` of `10,000.00` is stored
- **THEN** both transactions become `SELF_TRANSFER` with `needs_note` false

#### Scenario: Same amount but far apart
- **WHEN** the SBI `IN` of `10,000.00` arrives 40 minutes after the ICICI `OUT`
- **THEN** neither transaction is re-classified

### Requirement: Note prompt flag
`needs_note` SHALL be true only for `OUT` transactions in channel `UPI` or `CARD`. If a merchant rule exists for the counterparty with `skip_prompt` true, the rule's default note SHALL be stored as the user note and `needs_note` SHALL be false.

#### Scenario: Known merchant skips the prompt
- **WHEN** a merchant rule `MOMO WANG → "Snacks", skip_prompt = true` exists and the ICICI MOMO WANG debit is parsed
- **THEN** the user note is `Snacks` and `needs_note` is false
