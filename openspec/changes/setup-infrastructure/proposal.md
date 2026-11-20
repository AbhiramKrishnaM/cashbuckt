# Proposal

## Why

Every other CashBuckt feature (SMS ingestion, Web Push note prompts, month buckets, AI audit) needs a running HTTPS host, a Postgres database with the agreed schema, and backups of financial data that cannot be recreated. iOS Web Push only works over valid HTTPS. The ingestion endpoint must be live before the Nov 26–29, 2026 salary credit, so this foundation has to land first (target: Nov 21).

## What Changes

- Scaffold a minimal Next.js (App Router, TypeScript, Tailwind) app that serves a placeholder home page and a `GET /api/health` endpoint that checks database connectivity.
- Add a production `Dockerfile` for the app and a `docker-compose.yml` with three services: `postgres` (16), `app`, and `caddy`, plus a one-shot `migrate` service.
- Add versioned SQL migrations that create `month_buckets`, `transactions`, `push_subscriptions`, and `merchant_rules` with indexes and integrity constraints. Balances will be computed from transactions instead of stored, so `opening_balance` is not a stored source of truth (see design.md).
- Configure Caddy for automatic Let's Encrypt HTTPS on the project domain, redirecting HTTP to HTTPS and proxying to the app.
- Keep Postgres reachable only on the internal Docker network. Restrict the droplet to inbound 22/80/443 via the DigitalOcean Cloud Firewall, with SSH by key only.
- Add a daily 02:00 IST backup job: `pg_dump` → `age` encryption → upload to DigitalOcean Spaces with 30-day retention, plus a heartbeat on success so a missed backup is noticed.
- Add a documented restore procedure and verify it once end-to-end.
- Add a `docs/deploy.md` runbook covering droplet provisioning, first deploy, redeploys, and restore.

## Capabilities

### New Capabilities
- `platform-hosting`: How the app is served: HTTPS-only access on the project domain, the health endpoint, automatic recovery after container or host restarts, and no direct network access to the database.
- `transaction-storage`: The persistent data model (buckets, transactions, push subscriptions, merchant rules), its integrity guarantees (unique SMS hash, unique month key, valid types and amounts), and repeatable schema migrations.
- `data-backup`: Daily encrypted off-site backups, retention, failure detection, and a verified restore path.

### Modified Capabilities
<!-- None: no existing specs. -->

## Out of Scope

- SMS parsing, classification, the `POST /api/log-transaction` webhook, and salary carryover logic (change `add-sms-ingestion`).
- Web Push subscription, VAPID wiring, service worker, PWA manifest, and `/note/[id]` (change `add-note-prompt`).
- Dashboard UI, admin portal, admin authentication, and AI audit (later changes).
- CI/CD pipelines, container registries, staging environments, and multi-host setups. Deploys are a manual `git pull` + `docker compose up` on the droplet.
- Cloudflare / Zero Trust in front of the droplet.

## Impact

- **New code:** Next.js app skeleton (`app/`, `package.json`, `tsconfig.json`, Tailwind config), `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `db/migrations/*.sql`, `scripts/backup.sh`, `scripts/restore.sh`, `docs/deploy.md`.
- **New external systems:** DigitalOcean Droplet (Bengaluru `blr1`), Cloud Firewall, Spaces bucket, a domain with an A record pointing to the droplet, and Let's Encrypt via Caddy.
- **New dependencies:** `next`, `react`, `tailwindcss`, `pg` (Postgres client), the `dbmate` migration tool (as a container), `age`, and `rclone` (on the host for backups).
- **Config:** uses the existing `.env.example` keys (DB, Spaces, `BACKUP_AGE_RECIPIENT`) and adds `DOMAIN` and `BACKUP_HEARTBEAT_URL`.
