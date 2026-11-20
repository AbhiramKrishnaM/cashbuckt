#!/usr/bin/env bash
# Daily encrypted off-site backup: pg_dump | gzip | age  ->  DigitalOcean Spaces.
#
#   Cron (host TZ = Asia/Kolkata):
#     0 2 * * * /opt/cashbuckt/scripts/backup.sh >> /var/log/cashbuckt-backup.log 2>&1
#
# Plaintext never touches disk: the dump is streamed straight into age, and
# only the encrypted file is written (to a private temp file removed on exit).
# The heartbeat is pinged only after a successful upload + prune.
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER is not set}"
: "${POSTGRES_DB:?POSTGRES_DB is not set}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is not set}"
: "${SPACES_BUCKET:?SPACES_BUCKET is not set}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

log() { printf '%s [backup] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }

heartbeat() { # $1 = "" for success, "/fail" for failure
  [[ -n "${BACKUP_HEARTBEAT_URL:-}" ]] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_HEARTBEAT_URL}$1" || log "warning: heartbeat ping failed"
}

# rclone remote "spaces:" configured from env, so no rclone.conf with secrets on disk.
export RCLONE_CONFIG_SPACES_TYPE="${RCLONE_CONFIG_SPACES_TYPE:-s3}"
export RCLONE_CONFIG_SPACES_PROVIDER="${SPACES_PROVIDER:-DigitalOcean}"
export RCLONE_CONFIG_SPACES_ENDPOINT="${SPACES_ENDPOINT:-}"
export RCLONE_CONFIG_SPACES_ACCESS_KEY_ID="${SPACES_ACCESS_KEY:-}"
export RCLONE_CONFIG_SPACES_SECRET_ACCESS_KEY="${SPACES_SECRET_KEY:-}"
export RCLONE_CONFIG_SPACES_ACL=private
export RCLONE_CONFIG_SPACES_NO_CHECK_BUCKET=true

COMPOSE=(docker compose)
[[ -n "${COMPOSE_FILE_ARGS:-}" ]] && read -r -a COMPOSE <<<"docker compose ${COMPOSE_FILE_ARGS}"

STAMP="$(TZ=Asia/Kolkata date '+%Y-%m-%dT%H%M%S%z')"
NAME="cashbuckt-${STAMP}.sql.gz.age"
DEST="spaces:${SPACES_BUCKET}/daily"
TMP="$(mktemp "${TMPDIR:-/tmp}/cashbuckt-backup.XXXXXX")"

on_exit() {
  local code=$?
  rm -f "$TMP"
  if [[ $code -ne 0 ]]; then
    log "FAILED (exit $code)"
    heartbeat /fail
  fi
  exit "$code"
}
trap on_exit EXIT

log "dumping ${POSTGRES_DB}"
"${COMPOSE[@]}" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
  | gzip -9 \
  | age -r "$BACKUP_AGE_RECIPIENT" >"$TMP"

log "uploading ${NAME} ($(wc -c <"$TMP" | tr -d ' ') bytes)"
rclone copyto "$TMP" "${DEST}/${NAME}"

log "pruning backups older than ${RETENTION_DAYS} days"
rclone delete --min-age "${RETENTION_DAYS}d" "$DEST"

heartbeat ""
log "ok: ${NAME}"
