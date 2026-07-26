#!/bin/bash
# =============================================================================
#  OWNED BY:  InsightMetrics (JQ)
#  Mirrors the REAL Neon database into the local Postgres instance, verbatim
#  (2026-07-26) — written while Neon's network-transfer quota was fully
#  exceeded (every connection, including plain reads, was rejected), so this
#  couldn't be run/tested yet. Run it the moment Neon is reachable again
#  (check by running the SELECT 1 line below on its own first).
#
#  Uses pg_dump | pg_restore rather than a hand-written row-by-row seed
#  script — it captures the ACTUAL current data (every trip, delegate,
#  escalation, account, etc.) exactly as it exists on Neon right now, instead
#  of an approximation.
#
#  --clean --if-exists on restore means this is safe to re-run: it drops and
#  recreates each table from the dump rather than erroring on "already exists".
#
#  Usage:
#      cd backend/scripts && ./mirror-neon-to-local.sh
# =============================================================================
set -e

NEON_URL="postgresql://neondb_owner:npg_hnyx13leNJRW@ep-purple-heart-aop41ogj-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
LOCAL_DB="mustergo"
LOCAL_USER="postgres"
LOCAL_HOST="localhost"
PG_BIN="/c/Program Files/PostgreSQL/17/bin"
DUMP_FILE="neon_mirror.backup"

echo "=== 1. Confirming Neon is actually reachable first ==="
"$PG_BIN/psql.exe" "$NEON_URL" -c "SELECT 1;" || { echo "Neon still unreachable — stopping."; exit 1; }

echo "=== 2. Dumping Neon (schema + data, custom format) ==="
"$PG_BIN/pg_dump.exe" "$NEON_URL" --no-owner --no-privileges -F c -f "$DUMP_FILE"

echo "=== 3. Restoring into local mustergo (drops + recreates each table) ==="
PGPASSWORD=postgres "$PG_BIN/pg_restore.exe" -U "$LOCAL_USER" -h "$LOCAL_HOST" -d "$LOCAL_DB" \
  --no-owner --no-privileges --clean --if-exists "$DUMP_FILE"

echo "=== Done. Local Postgres now mirrors Neon's current data. ==="
rm -f "$DUMP_FILE"
