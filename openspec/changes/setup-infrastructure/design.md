# Design

## Context

The repo is greenfield: it holds only the blueprint (`cashbuckt.md`), OpenSpec config, and repo hygiene files. Motivation and scope are in proposal.md; behavior contracts are in `specs/platform-hosting`, `specs/transaction-storage`, and `specs/data-backup`.

Constraints that shape the approach:
- One small DigitalOcean droplet runs everything. Budget is $4–6/month.
- iOS Web Push and the Shortcuts webhook require a real domain with a valid HTTPS certificate.
- There is one operator (the owner), and deploys are manual. Simplicity beats automation.
- Data volume is tiny (about 4 MB/year). Performance is not a design driver; correctness and recoverability are.

## Goals / Non-Goals

**Goals:**
- `git clone` → fill in `.env` → `docker compose up -d` brings up a working HTTPS site with the schema applied.
- The same compose file works on a laptop for local dev, with a small dev overlay.
- Restoring from backup is a documented, rehearsed procedure, not a hope.

**Non-Goals:**
- Zero-downtime deploys. A few seconds of downtime during `up -d --build` is acceptable; Shortcuts can retry.
- Horizontal scaling, managed databases, Kubernetes.
- An ORM or query layer design. Later changes decide how app code queries the DB; this change only provides a connection pool helper.

## Decisions

### D1. Droplet: Ubuntu 24.04 LTS, `blr1`, 1 GB RAM ($6) + 2 GB swap
`next build` routinely needs more than 512 MB, so the $4 / 512 MB droplet would OOM during builds on the box. Bengaluru minimizes latency from the iPhone.
- *Alternative:* build images in GitHub Actions and push them to a registry, so the $4 droplet only pulls. Rejected for now because it adds CI, registry credentials, and moving parts. It can be revisited later.

### D2. App image: Next.js `output: 'standalone'`, multi-stage Dockerfile on `node:24-alpine`
Standalone output ships only the server and its traced dependencies, producing a roughly 150 MB image with a small memory footprint. Node 24 is the LTS line, and the version is pinned in `.nvmrc` and the Dockerfile so local and prod match. The container runs as a non-root user.

### D3. Migrations: plain SQL files run by `dbmate` as a one-shot compose service
The blueprint's schema is already SQL. dbmate applies `db/migrations/*.sql` (`-- migrate:up` / `-- migrate:down`), records versions in `schema_migrations`, and is idempotent. Running it as a `migrate` service with `restart: "no"`, which `app` depends on via `service_completed_successfully`, means every `docker compose up` applies pending migrations before the app starts.
- *Alternatives:* Prisma or Drizzle migrations would tie the schema to an ORM choice that this change deliberately does not make. A hand-rolled runner would mean writing and testing code that dbmate already provides.

### D4. Schema adjustments vs. the blueprint
- **Drop `month_buckets.opening_balance`; add `opening_adjustment NUMERIC(12,2) NOT NULL DEFAULT 0`.** A stored opening balance goes stale when November debits land after December's bucket was created by an early salary credit. Balances instead come from a `bucket_balances` view:
  `net(b) = adj(b) + in(b) − out(b)`, `opening(N) = adj(N) + Σ net(b) for b < N`, `closing(N) = opening(N) + in(N) − out(N)`.
  This uses a window `SUM` over `month_key` order. `month_key` sorts correctly as text because it is zero-padded `YYYY-MM`.
- **`ON DELETE RESTRICT` instead of `CASCADE`** on `transactions.bucket_id`, so deleting a bucket cannot silently erase a month of history.
- **CHECK constraints** on `txn_type`, `channel`, `amount > 0`, and `month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'`. CHECK is used instead of Postgres ENUMs because CHECK lists are easier to change in later migrations.
- `gen_random_uuid()` is built into Postgres 13+, so no extension is needed.
- `transacted_at` stays `TIMESTAMPTZ`. Postgres stores UTC, and IST conversion happens in queries and in the app. The DB session timezone is set to `Asia/Kolkata` so that ad-hoc `psql` output is readable.

### D5. Networking: internal-only Postgres, Caddy as the only public entrypoint
- The `postgres` service publishes **no ports** in `docker-compose.yml`. App and Caddy reach it over the default compose network.
- Docker-published ports bypass `ufw`, so the DigitalOcean **Cloud Firewall** (inbound 22/80/443 only) is the real perimeter, and the prod compose file must never publish 5432.
- A committed `compose.dev.yml` overlay, used only locally, publishes `127.0.0.1:5432` and skips Caddy.
- SSH: key-only (`PasswordAuthentication no`), root login by key only, and `unattended-upgrades` enabled.

### D6. Caddy for TLS
The `caddy:2-alpine` image reads `{$DOMAIN}` from env, gets and renews Let's Encrypt certificates automatically, redirects HTTP→HTTPS by default, and `reverse_proxy app:3000`. Certificates persist in the `caddy_data` volume, which avoids rate-limit trouble on rebuilds.
- *Alternative:* nginx + certbot. Rejected because it needs more config and a separate renewal cron.

### D7. Health endpoint
`GET /api/health` is forced dynamic and runs `SELECT 1` through a shared `pg` pool with a 2 s timeout, returning 200 or 503 as specified. Docker uses it as the `app` healthcheck. A small `lib/env.ts` validates required env vars on first use and throws naming the missing key, never its value.

### D8. Backups: host cron → `pg_dump | gzip | age` → `rclone` to Spaces
- `scripts/backup.sh` runs from host crontab at `0 2 * * *`, with the host timezone set to `Asia/Kolkata`. It streams `docker compose exec -T postgres pg_dump` through gzip and `age -r $BACKUP_AGE_RECIPIENT`, writes to a `mktemp` file removed by a `trap`, then uploads with `rclone copy` to `spaces:<bucket>/daily/`. Streaming keeps plaintext off disk entirely.
- **Key custody:** the age keypair is generated on the owner's laptop. The private key goes into a password manager and offline storage. Only the public recipient lives on the droplet.
- **Retention:** `rclone delete --min-age 30d` runs after a successful upload. It is done in the script rather than as a Spaces lifecycle rule, so the logic is versioned and visible in git.
- **Failure detection:** on success the script runs `curl -fsS $BACKUP_HEARTBEAT_URL`. A free healthchecks.io check (daily schedule, 2 h grace) emails the owner when a ping is missed, which covers job failures, cron not running, and the droplet being down.
- `set -euo pipefail` makes any failing stage abort without a heartbeat.
- *Alternative:* run backups in a sidecar container. Rejected because host cron plus a script is easier to debug and doesn't need the Docker socket inside a container.

### D9. Restore
`scripts/restore.sh <object>` downloads a backup, decrypts it with `age -d -i <keyfile>` (key supplied at run time, never stored), and pipes it into `psql` against an **empty** target database. The script refuses to run if the target has tables. The drill restores into a throwaway local Postgres and compares per-table row counts.

## Risks / Trade-offs

- [Let's Encrypt fails because DNS isn't pointing at the droplet yet] → Create the A record first and verify with `dig +short <DOMAIN>` before starting Caddy. Caddy retries with backoff and the certificate volume persists.
- [`next build` OOMs on 1 GB] → 2 GB swap file. If it still fails, fall back to the registry build in D1.
- [Single droplet is a single point of failure] → Accepted for a personal app. Daily off-site backups bound data loss to about 24 h. Missed SMS can be re-sent by re-running the Shortcut.
- [Losing the age private key makes every backup unrecoverable] → Keep it in two places (password manager + offline). The restore drill proves the stored key works.
- [Someone later adds `ports: 5432` to the prod compose file] → The Cloud Firewall still blocks it, and a comment in `docker-compose.yml` warns against it.
- [Derived balances cost a query per read] → Negligible at this data size (thousands of rows per year).

## Migration Plan

1. Owner buys or points a domain, creates the `blr1` droplet (Ubuntu 24.04, SSH key), Cloud Firewall, Spaces bucket + access key, and a healthchecks.io check.
2. On the droplet: harden SSH, set timezone, add swap, install Docker, `age`, `rclone`; `git clone`; create `.env` from `.env.example`.
3. `docker compose up -d --build`: migrate runs, app starts, Caddy issues the certificate.
4. Verify `https://<DOMAIN>/api/health`, install the crontab, run `backup.sh` once by hand, then run the restore drill locally.
5. **Redeploy:** `git pull && docker compose up -d --build`.
6. **Rollback:** `git checkout <prev> && docker compose up -d --build`. Schema rollbacks use `dbmate rollback`, but only before real data depends on the new schema; otherwise write a forward-fix migration.

## Open Questions

- Which domain name to use. Any domain works; it only fills `DOMAIN` and the DNS record.
- Whether to also enable DigitalOcean weekly droplet backups (+20% cost) as a second safety net. This doesn't affect any task here.
