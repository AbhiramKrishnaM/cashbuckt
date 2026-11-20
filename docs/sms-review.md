# Reviewing Unrecognized SMS & Adding Bank Formats

When an authenticated SMS looks like money but no parser understands it, the server stores it in
`unparsed_sms` (response `unrecognized`) instead of dropping it. Check this daily during the first
week, and after any bank changes its wording.

Run these on the droplet (`cd /opt/cashbuckt`) or locally against the dev stack.

## 1. List what needs review

```bash
docker compose exec -T postgres psql -U cashbuckt -d cashbuckt -c \
  "SELECT id, received_at, left(raw_sms, 160) AS sms FROM unparsed_sms WHERE NOT reviewed ORDER BY received_at"
```

How many, per day:

```bash
docker compose exec -T postgres psql -U cashbuckt -d cashbuckt -c \
  "SELECT received_at::date AS day, count(*) FROM unparsed_sms WHERE NOT reviewed GROUP BY 1 ORDER BY 1"
```

## 2. Decide what each one is

| It is… | Do this |
|---|---|
| A real transaction in a new format | Add or adjust a parser (section 3), then record the transaction (section 4) |
| Noise the filter missed (offer, statement, balance alert) | Add a pattern to `src/lib/sms/noise.ts` with a test, then mark it reviewed |
| Junk you don't care about | Mark it reviewed |

Mark one reviewed:

```bash
docker compose exec -T postgres psql -U cashbuckt -d cashbuckt -c \
  "UPDATE unparsed_sms SET reviewed = true WHERE id = '<id>'"
```

Mark everything currently listed as reviewed:

```bash
docker compose exec -T postgres psql -U cashbuckt -d cashbuckt -c \
  "UPDATE unparsed_sms SET reviewed = true WHERE NOT reviewed"
```

## 3. Add or fix a parser from a real SMS

1. Copy the raw SMS into the gitignored `sms-samples/` folder (unmasked copies stay out of git).
2. Make a **masked** copy: replace account and card digits, names and reference numbers with dummy values,
   keeping wording, punctuation and spacing exactly.
3. Add it to `tests/fixtures/sms.ts` with `confirmed: true` and the expected source, direction, amount,
   counterparty, account ref, date, channel and `needsNote`. If it replaces a representative fixture,
   edit that entry and flip `confirmed` to `true`.
4. Run the parser tests and watch the new case fail:

   ```bash
   npx vitest run tests/unit/sms
   ```

5. Adjust the regexes in `src/lib/sms/parsers/<bank>.ts`, or add a new parser module and register it
   in `src/lib/sms/parsers/index.ts`. Card parsers go before savings parsers.
6. Run `npm test` until everything passes, then commit and redeploy (`git pull && docker compose up -d --build`).

## 4. Record a reviewed SMS as a transaction

After the fix is deployed, re-send the stored text through the webhook. The text is unchanged, so its
hash is the same: delete the `unparsed_sms` row first, or the webhook answers `duplicate`.

```bash
ID=<id>
SMS=$(docker compose exec -T postgres psql -U cashbuckt -d cashbuckt -Atc "SELECT raw_sms FROM unparsed_sms WHERE id = '$ID'")
docker compose exec -T postgres psql -U cashbuckt -d cashbuckt -c "DELETE FROM unparsed_sms WHERE id = '$ID'"
SECRET=$(grep '^WEBHOOK_SECRET=' .env | cut -d= -f2)
python3 -c 'import json,sys; print(json.dumps({"sms": sys.argv[1]}))' "$SMS" | \
  curl -s -X POST "https://$(grep '^DOMAIN=' .env | cut -d= -f2)/api/log-transaction" \
    -H "Content-Type: application/json" -H "X-Webhook-Secret: $SECRET" --data @-
```

It's timed from the date in the SMS, so it lands in the right month even days later.
