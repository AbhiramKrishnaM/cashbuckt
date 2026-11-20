# iPhone Setup — Sending Bank SMS to CashBuckt

Three **Personal Automations** in the Shortcuts app forward every money-related SMS to
`POST https://<DOMAIN>/api/log-transaction`. The server ignores noise and duplicates, so the
three triggers overlapping is fine.

| Automation | Trigger: Message contains | Why |
|---|---|---|
| 1 | `Rs` | Most bank and card SMS |
| 2 | `INR` | ICICI card and EMI SMS use "INR" |
| 3 | `debited` | SBI UPI debits print a bare amount ("debited by 250.0") |

You need the `WEBHOOK_SECRET` value from the droplet's `/opt/cashbuckt/.env`.

---

## 1. Smoke-test the server first (laptop)

```bash
DOMAIN=<your-domain>
SECRET=<WEBHOOK_SECRET>
curl -s -X POST "https://$DOMAIN/api/log-transaction" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  --data '{"sms":"ICICI Bank Acct XX123 debited for Rs 1.00 on 20-Nov-26; SMOKE TEST credited. UPI:600000000999. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766"}'
```

Expected: `{"status":"saved",...,"channel":"UPI","needs_note":true}`. Run it again and you get `{"status":"duplicate",...}`.
A wrong secret returns HTTP 401. Delete the smoke-test row afterwards:

```bash
ssh root@<droplet-ip> "cd /opt/cashbuckt && docker compose exec -T postgres psql -U cashbuckt -d cashbuckt -c \"DELETE FROM transactions WHERE merchant_vpa = 'SMOKE TEST'\""
```

## 2. Create automation 1 ("Rs")

1. Open **Shortcuts** → **Automation** tab → **+** (or **New Automation**).
2. Choose **Message**.
3. **Message Contains**: type `Rs`. Leave **Sender** empty, since banks use many sender IDs.
4. Select **Run Immediately**, and turn **Notify When Run** off. (On iOS versions that show
   "Ask Before Running", turn that **off**. If shown, turn **Allow Running When Locked** **on**.)
5. Tap **Next** → **New Blank Automation**, then add these actions in order:

   **a. Stop if it's an OTP** (OTPs never leave the phone)
   - Add **If**. Input: **Shortcut Input**, condition **contains**, text `OTP`.
   - Inside the If, add **Stop This Shortcut**.
   - Leave **Otherwise** empty. **End If** closes the block.

   **b. Send the SMS**
   - Add **Get Contents of URL**.
   - URL: `https://<DOMAIN>/api/log-transaction`
   - Tap **▸ Show More**:
     - **Method**: `POST`
     - **Headers**: add `X-Webhook-Secret` = `<WEBHOOK_SECRET>`
     - **Request Body**: `JSON` → add field, key `sms`, type **Text**, value: the **Shortcut Input**
       variable. If iOS offers a property for it, pick **Content** (the message text), not the sender.

6. Tap **Done**.

## 3. Create automations 2 and 3

Repeat step 2 with **Message Contains** set to `INR`, then again with `debited`. The actions are identical.

Tip: after building the first one, use long-press → **Duplicate** on the automation if your iOS version offers it,
then change only the trigger text.

## 4. Verify with a real payment

1. Make a ₹1–₹10 UPI payment from ICICI.
2. When the bank SMS arrives, open Shortcuts → Automation. The automations should show they ran.
3. On the droplet:

```bash
cd /opt/cashbuckt
docker compose exec -T postgres psql -U cashbuckt -d cashbuckt -c \
  "SELECT transacted_at, bank, channel, amount, merchant_vpa, needs_note FROM transactions ORDER BY transacted_at DESC LIMIT 5"
docker compose logs app | grep '\[ingest\]' | tail -10
```

Each SMS logs one line per automation that fired: `saved` for the first, `duplicate` for the others.

## What happens to each SMS

| Server says | Meaning | Stored? |
|---|---|---|
| `saved` | Parsed into a transaction | Yes |
| `duplicate` | Already received (another automation, or a re-run) | No |
| `ignored` | Noise: OTP, reminder, "will be debited", declined, offers | No |
| `unrecognized` | Looks like money but no parser understood it | Yes, in `unparsed_sms` for review (see `docs/sms-review.md`) |
| HTTP 401 | Wrong or missing `X-Webhook-Secret` | No |
| HTTP 500 | Server or database problem; re-run the automation later | No |

## Troubleshooting

| Symptom | Check |
|---|---|
| Automation never runs | It must be **Run Immediately** with no confirmation. Check iOS **Settings → Shortcuts** for permission prompts |
| Runs but nothing is stored | Run the curl smoke test. Check the URL starts with `https://` and the header name is exactly `X-Webhook-Secret` |
| Everything says `unrecognized` | The body is probably sending the message object, not its text. Re-pick **Shortcut Input → Content** |
| Card SMS missing | Check whether that card's SMS contains "Rs", "INR" or "debited". If not, add a fourth automation with a word it does contain |
