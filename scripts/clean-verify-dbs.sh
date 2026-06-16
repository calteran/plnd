#!/usr/bin/env bash
# scripts/clean-verify-dbs.sh — Janitor for orphaned `plnd_verify_*` databases.
#
# Usage: clean-verify-dbs.sh [MIN_AGE]
#   MIN_AGE   Postgres interval; only drop DBs older than this. Default "1 hour".
#             Pass "0" to drop every unconnected orphan regardless of age.
#
# `scripts/verify.sh` creates a per-run application DB `plnd_verify_<runid>` on the
# shared Postgres and drops it in its EXIT/INT/TERM trap. That trap does NOT fire on
# SIGKILL (kill -9, OOM) or if the process dies between CREATE DATABASE and cleanup,
# so orphaned `plnd_verify_*` DBs accumulate over time. This sweep reclaims them.
#
# Safety: a DB is dropped only when BOTH hold:
#   • it has no active backend connection — a running verify holds a connection to
#     its DB (via plnd_api's pool), so live runs are never touched; AND
#   • its on-disk directory is older than MIN_AGE — covers the brief window in
#     verify.sh between CREATE DATABASE and the API's first connection, during which
#     a legitimately in-use DB momentarily has zero connections.
# Scope is hard-limited to the `plnd_verify_` prefix: `plnd_dev` and sqlx's
# `_sqlx_test_*` DBs are never candidates.

set -euo pipefail

MIN_AGE="${1:-1 hour}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Helper: run a psql command inside the shared db container.
psql_db() { docker compose exec -T db psql -U plnd -d postgres "$@"; }

if ! docker compose ps --status running --services 2>/dev/null | grep -qx db; then
    echo "→ Shared db container is not running; nothing to sweep." >&2
    exit 0
fi

# Build the age predicate. pg_stat_file('base/<oid>', true) returns the database
# directory's modification time (NULL row if the path is gone — NULL fails the
# comparison and is excluded, which is the safe default). MIN_AGE="0" disables it.
if [[ "$MIN_AGE" == "0" ]]; then
    AGE_PREDICATE="true"
else
    AGE_PREDICATE="(pg_stat_file('base/' || d.oid, true)).modification < now() - interval '${MIN_AGE}'"
fi

# Candidate orphans: prefix-scoped, no active connection, older than MIN_AGE.
# (A while/read loop rather than `mapfile` — the latter is bash 4+, and macOS
# ships bash 3.2, which is the floor scripts/verify.sh also targets.)
declare -a ORPHANS=()
while IFS= read -r db; do
    [[ -n "$db" ]] && ORPHANS+=("$db")
done < <(psql_db -tAc "
    SELECT d.datname
    FROM pg_database d
    WHERE d.datname LIKE 'plnd\\_verify\\_%'
      AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)
      AND ${AGE_PREDICATE}
    ORDER BY d.datname;" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

if [[ "${#ORPHANS[@]}" -eq 0 ]]; then
    echo "✓ No orphaned plnd_verify_* databases to drop."
    exit 0
fi

echo "→ Dropping ${#ORPHANS[@]} orphaned plnd_verify_* database(s)..."
for db in "${ORPHANS[@]}"; do
    # WITH (FORCE) guards the slim chance a connection appears between SELECT and DROP.
    # Capture stderr and surface it only on failure — a real error (permissions,
    # unexpected state) is then visible for diagnosis, without printing the benign
    # compose "DB_PASSWORD not set" warning on every successful drop.
    if drop_err="$(psql_db -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);" 2>&1 >/dev/null)"; then
        echo "  ✓ dropped $db"
    else
        echo "  ✗ could not drop $db (left in place)" >&2
        [[ -n "$drop_err" ]] && printf '%s\n' "$drop_err" | sed 's/^/      /' >&2
    fi
done
