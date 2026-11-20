# Tasks

## 1. App scaffold

- [x] 1.1 Scaffold Next.js (App Router, TypeScript, Tailwind, ESLint, `src/` dir) with npm, add `.nvmrc` = 24, set `output: 'standalone'` in `next.config.ts`; verify `npm run build` succeeds and `npm run dev` serves a placeholder `/` page
- [x] 1.2 Add `vitest` with an `npm test` script and one trivial passing test; verify `npm test` exits 0

## 2. Database schema & migrations

- [x] 2.1 Add `compose.dev.yml` + minimal `docker-compose.yml` `postgres:16-alpine` service (named volume `pgdata`, `pg_isready` healthcheck, `TZ`/`PGTZ=Asia/Kolkata`, no published ports in base file; dev overlay publishes `127.0.0.1:5432`); verify `docker compose -f docker-compose.yml -f compose.dev.yml up -d postgres` reports healthy and `psql` connects from the laptop
- [x] 2.2 Write `db/migrations/<ts>_init_schema.sql` creating `month_buckets` (with `opening_adjustment`, `month_key` CHECK), `transactions` (CHECKs on type/channel/amount, unique `sms_hash`, `ON DELETE RESTRICT`), `push_subscriptions`, `merchant_rules`, and `idx_transactions_bucket`, with a working `migrate:down`; verify `dbmate up`, `dbmate rollback`, `dbmate up` all succeed
- [x] 2.3 Add the `bucket_balances` view (opening / in / out / closing per bucket per design D4) as a second migration; verify `SELECT * FROM bucket_balances` runs on an empty DB
- [x] 2.4 Add the `migrate` one-shot service (`ghcr.io/amacneil/dbmate`, mounts `db/`, depends on healthy postgres); verify running it twice in a row exits 0 both times and the second run applies nothing
- [x] 2.5 Write integration tests (vitest against the dev Postgres, each test in a rolled-back transaction) for every `transaction-storage` scenario: duplicate/malformed `month_key`, invalid type/channel, zero/negative amount, exact NUMERIC sum `142000.00 + 2.50`, duplicate `sms_hash`, duplicate push endpoint, non-empty bucket delete blocked; verify `npm test` passes
- [x] 2.6 Write integration tests for `bucket_balances`: first-month seeding (adj ₹20,000, out ₹3,000 → close ₹17,000, next month opens ₹17,000) and late prior-month debit (insert ₹500 OUT into `2026-11` after `2026-12` exists → `2026-12` opening drops ₹500); verify `npm test` passes

## 3. App runtime: env, DB pool, health

- [x] 3.1 Add `src/lib/env.ts` (validates required vars, throws naming the missing key without values) and `src/lib/db.ts` (shared `pg` pool, 2 s connect timeout, session TZ `Asia/Kolkata`); verify a unit test for missing `DATABASE_URL` asserts the error names the key and contains no secret
- [x] 3.2 Implement `GET /api/health` (forced dynamic, `SELECT 1`, 200 `{"status":"ok","db":"ok"}` / 503 `{"status":"degraded","db":"down"}`); verify integration tests cover both cases, the DB-down one using an unreachable `DATABASE_URL`, and assert no connection details appear in the body

## 4. Containerized stack

- [x] 4.1 Write the multi-stage `Dockerfile` (`node:24-alpine`, standalone output, non-root user, `HEALTHCHECK` on `/api/health`) and `.dockerignore`; verify `docker build .` succeeds and the image is under 300 MB
- [x] 4.2 Complete `docker-compose.yml`: `app` (depends on `migrate` completed successfully, `restart: unless-stopped`, `env_file: .env`), `caddy:2-alpine` (ports 80/443, `caddy_data`/`caddy_config` volumes), `restart: unless-stopped` on postgres/caddy, plus a warning comment against publishing 5432; verify `docker compose config` is valid
- [x] 4.3 Write the `Caddyfile` (`{$DOMAIN}` → `reverse_proxy app:3000`); add `DOMAIN` and `BACKUP_HEARTBEAT_URL` to `.env.example`; verify locally with `DOMAIN=localhost` that `docker compose up -d` gives `curl -k https://localhost/api/health` → 200 and `curl -I http://localhost` → redirect to HTTPS
- [x] 4.4 Verify crash recovery locally: SIGKILL the app's node process from outside the Docker API (`docker run --rm --privileged --pid=host alpine kill -9 <State.Pid>`; note `docker compose kill` counts as a manual stop and does not trigger `unless-stopped`) and confirm it restarts and health returns 200 again

## 5. Backups & restore

- [x] 5.1 Write `scripts/backup.sh` (`set -euo pipefail`, stream `pg_dump | gzip | age -r` to a `mktemp` file with `trap` cleanup, `rclone copy` to `spaces:$SPACES_BUCKET/daily/` with timestamped name, `rclone delete --min-age 30d`, heartbeat `curl` only on success, no secrets in logs); verify `shellcheck` is clean and a local run against a test bucket uploads an `.age` object and leaves no plaintext in `/tmp`
- [x] 5.2 Verify backup failure handling: run with a bad Spaces key and confirm a non-zero exit, no heartbeat sent, and no secret in output
- [x] 5.3 Write `scripts/restore.sh <object> <age-key-file> <target-db-url>` (download, `age -d`, `gunzip`, `psql`; refuses if the target has tables); verify running it against a non-empty DB aborts with a clear message
- [x] 5.4 Restore drill: seed the dev DB with sample buckets/transactions, back up, restore into a fresh Postgres container, compare per-table row counts with a small script; verify counts match exactly

## 6. Droplet provisioning & go-live (owner + runbook)

- [x] 6.1 Write `docs/deploy.md` covering: domain A record, droplet (Ubuntu 24.04, `blr1`, 1 GB, SSH key), Cloud Firewall 22/80/443, SSH hardening, `timedatectl set-timezone Asia/Kolkata`, 2 GB swap, Docker/age/rclone install, `.env` creation, age keypair generation on laptop and key custody, healthchecks.io setup, first deploy, redeploy, rollback, and restore; verify every command block is copy-pasteable as written
- [ ] 6.2 Provision droplet, firewall, DNS, Spaces bucket, and healthchecks.io check following `docs/deploy.md`; verify `dig +short <DOMAIN>` returns the droplet IP and `ssh -o PubkeyAuthentication=no <host>` is rejected
- [ ] 6.3 First deploy on the droplet with `docker compose up -d --build`; verify `curl https://<DOMAIN>/api/health` → 200 with a trusted cert, `http://` redirects, and `nc -vz <droplet-ip> 5432` from the laptop fails
- [ ] 6.4 Install the crontab (`0 2 * * *` → `backup.sh`, logging to `/var/log/cashbuckt-backup.log`), run it once manually; verify the object appears in Spaces and the healthchecks.io check turns green
- [ ] 6.5 Reboot the droplet; verify health returns 200 within 2 minutes without manual action
- [ ] 6.6 Production restore drill: restore the first prod backup into a local throwaway Postgres; verify table row counts match prod

## Workflow follow-up

- Archive the change with `/opsx:archive` after all tasks are checked and the restore drill has passed.
- Then start `add-sms-ingestion`, which must be live before the Nov 26–29 salary credit.
