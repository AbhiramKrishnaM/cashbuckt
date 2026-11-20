#!/usr/bin/env bash
# Restore an encrypted backup from Spaces into an EMPTY Postgres database.
#
#   scripts/restore.sh <object-name|latest> <age-key-file> <target-db-url>
#
# Example (restore drill on the laptop):
#   docker run -d --rm --name drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=restored \
#     -p 127.0.0.1:55433:5432 postgres:16-alpine
#   scripts/restore.sh latest ~/secure/cashbuckt-backup.key \
#     postgres://postgres:drill@127.0.0.1:55433/restored
#
# The age private key is read at run time and never copied anywhere.
# psql runs in a postgres:16 container (host networking) so the client
# matches the server major version; override with RESTORE_PSQL="psql".
set -euo pipefail
umask 077

usage() { echo "usage: $0 <object-name|latest> <age-key-file> <target-db-url>" >&2; exit 2; }
[[ $# -eq 3 ]] || usage
OBJECT="$1" KEY_FILE="$2" TARGET_URL="$3"
[[ -r "$KEY_FILE" ]] || { echo "error: cannot read age key file: $KEY_FILE" >&2; exit 2; }

cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
: "${SPACES_BUCKET:?SPACES_BUCKET is not set}"

export RCLONE_CONFIG_SPACES_TYPE="${RCLONE_CONFIG_SPACES_TYPE:-s3}"
export RCLONE_CONFIG_SPACES_PROVIDER="${SPACES_PROVIDER:-DigitalOcean}"
export RCLONE_CONFIG_SPACES_ENDPOINT="${SPACES_ENDPOINT:-}"
export RCLONE_CONFIG_SPACES_ACCESS_KEY_ID="${SPACES_ACCESS_KEY:-}"
export RCLONE_CONFIG_SPACES_SECRET_ACCESS_KEY="${SPACES_SECRET_KEY:-}"
SRC="spaces:${SPACES_BUCKET}/daily"

read -r -a PSQL <<<"${RESTORE_PSQL:-docker run --rm -i --network host postgres:16-alpine psql}"
psql_target() { "${PSQL[@]}" "$TARGET_URL" "$@"; }

log() { printf '%s [restore] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }

# Refuse to restore over existing data.
tables="$(psql_target -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
if [[ "$tables" != "0" ]]; then
  echo "error: target database is not empty ($tables tables in public schema); refusing to restore" >&2
  exit 1
fi

if [[ "$OBJECT" == "latest" ]]; then
  # Newest by modification time ("<YYYY-MM-DD HH:MM:SS>|<name>" sorts chronologically).
  OBJECT="$(rclone lsf --format tp --separator '|' --include 'cashbuckt-*.sql.gz.age' "$SRC" \
    | sort | tail -n 1 | cut -d'|' -f2-)"
  [[ -n "$OBJECT" ]] || { echo "error: no backups found in $SRC" >&2; exit 1; }
fi

TMP="$(mktemp "${TMPDIR:-/tmp}/cashbuckt-restore.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

log "downloading ${OBJECT}"
rclone copyto "${SRC}/${OBJECT}" "$TMP"

log "decrypting and loading into target database"
age -d -i "$KEY_FILE" "$TMP" | gunzip | psql_target -q -v ON_ERROR_STOP=1 --single-transaction >/dev/null

log "ok: restored ${OBJECT}"
