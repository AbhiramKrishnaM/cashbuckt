#!/usr/bin/env bash
# Print "<table> <rows>" for every table in the public schema (sorted).
# Used by the restore drill to compare source and restored databases:
#   diff <(scripts/row-counts.sh "$SRC_URL") <(scripts/row-counts.sh "$RESTORED_URL")
set -euo pipefail
[[ $# -eq 1 ]] || { echo "usage: $0 <db-url>" >&2; exit 2; }
read -r -a PSQL <<<"${RESTORE_PSQL:-docker run --rm -i --network host postgres:16-alpine psql}"

"${PSQL[@]}" "$1" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT format('SELECT %L || '' '' || count(*) FROM %I;', table_name, table_name)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name
\gexec
SQL
