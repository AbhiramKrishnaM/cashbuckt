# CashBuckt — Deploy & Operations Runbook

Single DigitalOcean droplet running `postgres` + `migrate` + `app` + `caddy` via Docker Compose,
with nightly encrypted backups to DigitalOcean Spaces. Every block below is meant to be copy-pasted.
Replace values in `<angle brackets>`.

| Thing | Value |
|---|---|
| Droplet | Ubuntu 24.04 LTS, `blr1`, Basic 1 GB / 1 vCPU ($6), SSH key auth |
| App path on droplet | `/opt/cashbuckt` |
| Backups | `spaces:<bucket>/daily/cashbuckt-<timestamp>.sql.gz.age`, 30-day retention |
| Backup schedule | 02:00 IST daily (host timezone is `Asia/Kolkata`) |

---

## 0. One-time prerequisites (laptop)

```bash
brew install age rclone
```

### 0.1 Push the repo to a private remote

The droplet clones the code from git. Create an **empty private** repo on GitHub, then:

```bash
cd ~/Desktop/Projects/cashbuckt
git remote add origin git@github.com:<you>/cashbuckt.git
git push -u origin main
```

### 0.2 Generate the backup encryption key (never put the private key on the droplet)

```bash
mkdir -p ~/secure && chmod 700 ~/secure
age-keygen -o ~/secure/cashbuckt-backup.key
chmod 600 ~/secure/cashbuckt-backup.key
grep 'public key' ~/secure/cashbuckt-backup.key
```

- Copy the printed `age1…` public key — it becomes `BACKUP_AGE_RECIPIENT` on the droplet.
- Store the **whole file** `~/secure/cashbuckt-backup.key` in your password manager **and** one offline copy
  (USB drive / printed). Losing it makes every backup unrecoverable.

---

## 1. DigitalOcean resources (web console)

1. **Droplet** → Create → Ubuntu 24.04 (LTS) x64 → Region **Bangalore (BLR1)** → Basic, Regular,
   **1 GB / 1 CPU** → Authentication: **SSH Key** (add your laptop's `~/.ssh/id_ed25519.pub`) →
   hostname `cashbuckt`. Note the public IPv4.
2. **Cloud Firewall** → Networking → Firewalls → Create `cashbuckt-fw`:
   - Inbound: `SSH TCP 22`, `HTTP TCP 80`, `HTTPS TCP 443`, `Custom UDP 443` (HTTP/3) — sources: All IPv4/IPv6.
   - Outbound: leave defaults (all).
   - Apply to droplet `cashbuckt`.
3. **Spaces bucket** → Spaces Object Storage → Create → region **BLR1** → name e.g. `cashbuckt-backups-<random>` →
   **Restrict file listing** on (private).
4. **Spaces access key** → API → Spaces Keys → Generate → **limited to the backup bucket**, read/write.
   Save the key ID and secret for `.env`.

## 2. DNS

At your domain registrar / DNS provider, create an **A record** `<DOMAIN>` → `<droplet-ip>` (TTL 300). Then:

```bash
dig +short <DOMAIN>
```

It must print the droplet IP **before** you start Caddy (step 5), or Let's Encrypt validation fails.

## 3. Backup monitor (healthchecks.io, free)

1. Sign up at https://healthchecks.io → **Add Check** → name `cashbuckt-backup`.
2. Schedule: **Cron** `0 2 * * *`, time zone **Asia/Kolkata**, grace time **2 hours**.
3. Integrations: email (default) — add the Telegram/Slack integration too if you like.
4. Copy the ping URL (`https://hc-ping.com/<uuid>`) → `BACKUP_HEARTBEAT_URL`.

The backup script pings it on success and pings `<url>/fail` on failure, so you're alerted
either immediately (failure) or after the grace period (cron didn't run / droplet down).

---

## 4. Droplet setup (as root over SSH)

```bash
ssh root@<droplet-ip>
```

### 4.1 Packages, timezone, automatic security updates

```bash
apt-get update && apt-get -y upgrade
apt-get install -y git curl age rclone unattended-upgrades
timedatectl set-timezone Asia/Kolkata
systemctl restart cron
dpkg-reconfigure -f noninteractive unattended-upgrades
```

### 4.2 SSH hardening (key-only)

```bash
cat > /etc/ssh/sshd_config.d/99-cashbuckt.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t && systemctl reload ssh
```

Keep this session open and confirm a **new** SSH session still works before logging out.

### 4.3 2 GB swap (so `next build` doesn't OOM on 1 GB RAM)

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h
```

### 4.4 Docker Engine + Compose plugin

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker compose version
```

### 4.5 Code + config

The droplet needs read access to the private repo. Simplest: a read-only **deploy key**.

```bash
ssh-keygen -t ed25519 -N '' -f /root/.ssh/cashbuckt_deploy -C cashbuckt-droplet
cat /root/.ssh/cashbuckt_deploy.pub
```

Add that public key in GitHub → repo → Settings → Deploy keys (read-only). Then:

```bash
cat >> /root/.ssh/config <<'EOF'
Host github.com
  IdentityFile /root/.ssh/cashbuckt_deploy
  IdentitiesOnly yes
EOF
git clone git@github.com:<you>/cashbuckt.git /opt/cashbuckt
cd /opt/cashbuckt
cp .env.example .env
chmod 600 .env
```

Fill in `.env` (`nano .env`). Generate secrets with:

```bash
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 32   # WEBHOOK_SECRET, SESSION_SECRET
```

Required for this stage: `DOMAIN`, `APP_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
`BACKUP_AGE_RECIPIENT`, `SPACES_ENDPOINT` (`https://blr1.digitaloceanspaces.com`), `SPACES_BUCKET`,
`SPACES_ACCESS_KEY`, `SPACES_SECRET_KEY`, `BACKUP_HEARTBEAT_URL`. (`DATABASE_URL` in `.env` is only for
local `npm run dev`; containers build their own.)

---

## 5. First deploy

```bash
cd /opt/cashbuckt
docker compose up -d --build
docker compose ps
docker compose logs migrate
```

`migrate` should show `Applied: …` and exit 0; `app`, `postgres` become `healthy`; `caddy` obtains the certificate
(watch with `docker compose logs -f caddy`).

Verify from the **laptop**:

```bash
curl -s https://<DOMAIN>/api/health          # {"status":"ok","db":"ok"}
curl -sI http://<DOMAIN>/ | head -3           # 308 → https://
nc -vz -w 5 <droplet-ip> 5432                 # must FAIL (refused / timed out)
ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password root@<droplet-ip>   # must be rejected
```

## 6. Backups

### 6.1 Cron + log rotation

```bash
chmod +x /opt/cashbuckt/scripts/*.sh
( crontab -l 2>/dev/null; echo '0 2 * * * /opt/cashbuckt/scripts/backup.sh >> /var/log/cashbuckt-backup.log 2>&1' ) | crontab -
crontab -l
cat > /etc/logrotate.d/cashbuckt-backup <<'EOF'
/var/log/cashbuckt-backup.log {
  monthly
  rotate 6
  compress
  missingok
  notifempty
}
EOF
```

### 6.2 First run by hand

```bash
/opt/cashbuckt/scripts/backup.sh
```

Expect `[backup] ok: cashbuckt-<timestamp>.sql.gz.age`. Check the object in the Spaces console and that the
healthchecks.io check turned **green**.

## 7. Restore (and the restore drill)

Run on the **laptop** — that's where the private key lives. Needs Docker, `age`, `rclone`, and a local `.env`
with the `SPACES_*` values (copy them from the droplet's `.env`).

```bash
cd ~/Desktop/Projects/cashbuckt
docker run -d --rm --name cashbuckt-drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=restored \
  -p 127.0.0.1:55433:5432 postgres:16-alpine
sleep 5
scripts/restore.sh latest ~/secure/cashbuckt-backup.key postgres://postgres:drill@127.0.0.1:55433/restored
scripts/row-counts.sh postgres://postgres:drill@127.0.0.1:55433/restored
```

Compare with production (on the droplet):

```bash
cd /opt/cashbuckt
RESTORE_PSQL="docker compose exec -T postgres psql -U cashbuckt" scripts/row-counts.sh cashbuckt
```

Counts must match (allowing for transactions that arrived after the backup). Then `docker stop cashbuckt-drill`.

**Real disaster recovery** (droplet lost): provision a new droplet (sections 1–4), `docker compose up -d postgres`,
then restore into it. The target must be empty, so restore *before* starting `migrate`/`app`:

```bash
# on the laptop, via an SSH tunnel to the new droplet's postgres container IP
ssh root@<new-ip> "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' cashbuckt-postgres-1"
ssh -N -L 55434:<container-ip>:5432 root@<new-ip> &
scripts/restore.sh latest ~/secure/cashbuckt-backup.key postgres://cashbuckt:<POSTGRES_PASSWORD>@127.0.0.1:55434/cashbuckt
kill %1
ssh root@<new-ip> "cd /opt/cashbuckt && docker compose up -d --build"
```

`migrate` then sees all versions already applied and does nothing.

## 8. Redeploy & rollback

```bash
cd /opt/cashbuckt
git pull
docker compose up -d --build
```

Rollback code:

```bash
cd /opt/cashbuckt
git log --oneline -5
git checkout <previous-sha>
docker compose up -d --build
```

Schema rollback (`docker compose run --rm migrate rollback`) only **before** real data depends on the new
schema — otherwise write a forward-fix migration.

## 9. Local development

```bash
docker compose -f docker-compose.yml -f compose.dev.yml up -d postgres migrate   # Postgres on 127.0.0.1:55432
npm run dev                                                                         # uses DATABASE_URL from .env
npm test                                                                            # unit + integration tests
```

Full stack with local HTTPS (Caddy internal CA): set `DOMAIN=localhost` in `.env`, then
`docker compose up -d --build` and `curl -k https://localhost/api/health`.

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| Caddy can't get a cert | `dig +short <DOMAIN>` = droplet IP? Ports 80/443 open in Cloud Firewall? `docker compose logs caddy` |
| `next build` killed during deploy | `free -h` shows swap? (section 4.3) |
| Health returns 503 | `docker compose ps postgres`, `docker compose logs app` |
| healthchecks.io alert | `tail -50 /var/log/cashbuckt-backup.log`; rerun `scripts/backup.sh` by hand |
| App won't start: "Missing required environment variable" | Add the named key to `/opt/cashbuckt/.env` |
