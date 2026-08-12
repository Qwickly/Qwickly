#!/usr/bin/env bash
# Qwickly DB audit collector.
# Reads DATABASE_URL from the environment - never writes it to disk.
# Read-only against the database: pg_dump --schema-only + SELECT-only introspection.

set -euo pipefail

OUT_DIR="$(cd "$(dirname "$0")" && pwd)"
PG_IMAGE="postgres:17-alpine"

# Fall back to the local db.env (which lives outside the git repo) if the
# variable is not already exported in the environment.
if [[ -z "${DATABASE_URL:-}" && -f "$OUT_DIR/db.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$OUT_DIR/db.env"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set (checked env and $OUT_DIR/db.env)." >&2
  exit 1
fi

if [[ "$DATABASE_URL" == *YOUR_PASSWORD_HERE* ]]; then
  echo "ERROR: db.env still contains the placeholder password." >&2
  exit 1
fi

# Docker on Windows needs a Windows-style path for the bind mount.
MOUNT_PATH="$(cygpath -w "$OUT_DIR" 2>/dev/null || echo "$OUT_DIR")"

echo "== pulling $PG_IMAGE (if needed) =="
docker image inspect "$PG_IMAGE" >/dev/null 2>&1 || docker pull "$PG_IMAGE"

echo
echo "== 1/3 connectivity check =="
docker run --rm -e PGCONNECT_TIMEOUT=15 -e DATABASE_URL "$PG_IMAGE" \
  psql "$DATABASE_URL" -Atc "select current_database() || ' @ ' || version();"

echo
echo "== 2/3 schema dump =="
# --schema-only: structure, no data. Restricted to the public schema so we skip
# Supabase-internal schemas (auth, storage, realtime, ...) that we do not own.
docker run --rm -e DATABASE_URL "$PG_IMAGE" \
  pg_dump "$DATABASE_URL" \
    --schema-only \
    --schema=public \
    --no-owner \
    --no-privileges \
    --no-comments \
  > "$OUT_DIR/schema.sql"
echo "wrote schema.sql ($(wc -l < "$OUT_DIR/schema.sql") lines)"

# Same dump but WITH grants/ownership - needed to reason about RLS + role access.
docker run --rm -e DATABASE_URL "$PG_IMAGE" \
  pg_dump "$DATABASE_URL" --schema-only --schema=public \
  > "$OUT_DIR/schema-full.sql"
echo "wrote schema-full.sql ($(wc -l < "$OUT_DIR/schema-full.sql") lines)"

echo
echo "== 3/3 introspection queries =="
docker run --rm -e DATABASE_URL \
  -v "${MOUNT_PATH}:/out" \
  -v "${MOUNT_PATH}/introspect.sql:/introspect.sql:ro" \
  "$PG_IMAGE" \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /introspect.sql

echo
echo "== done. artifacts in $OUT_DIR =="
ls -la "$OUT_DIR"/*.csv "$OUT_DIR"/*.sql 2>/dev/null
