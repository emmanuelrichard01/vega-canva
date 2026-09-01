#!/usr/bin/env bash
#
# Take a logical backup of the database and put it in object storage.
#
# ## Why this exists when the database already has restore
#
# Neon keeps a history window and can branch from a past instant, which is
# genuinely good and is the right first thing to reach for. On the Free plan
# that window is **6 hours, capped at 1 GB of change history**. A bad write
# noticed the next morning is outside it. So is anything found on a Monday.
#
# It is also the same account. A billing lapse, a mistaken project delete, or
# losing access to the Neon login takes the database and its history together,
# because they were never two things.
#
# This is the second copy: a full logical dump, in a different vendor, on a
# retention you choose. It is slower to restore than a branch and that is
# fine -- it is not competing with the history window, it is what remains
# after the history window has been used and did not reach far enough.
#
# ## Usage
#
#   BACKUP_DATABASE_URL=postgres://...  \
#   R2_BUCKET=vega-canva-backups        \
#   R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
#   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...        \
#   ./backup-db.sh [--dry-run] [--keep N] [--prefix daily]
#
# Requires `pg_dump`/`pg_restore` (major version >= the server's) and `aws`.

set -euo pipefail

KEEP=30
PREFIX="daily"
DRY_RUN=0
# A dump smaller than this is a failure that exited 0 -- an empty file, a
# permission error swallowed by the pipe, a connection dropped at hello. The
# floor is deliberately tiny: it is catching "nothing", not "less than usual".
MIN_BYTES=1024

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --keep) KEEP="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "backup-db: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

fail() { echo "backup-db: $1" >&2; exit 1; }

[ -n "${BACKUP_DATABASE_URL:-}" ] || fail "BACKUP_DATABASE_URL is required"
[ -n "${R2_BUCKET:-}" ]           || fail "R2_BUCKET is required"
[ -n "${R2_ENDPOINT:-}" ]         || fail "R2_ENDPOINT is required"
command -v pg_dump >/dev/null    || fail "pg_dump not found on PATH"
command -v pg_restore >/dev/null || fail "pg_restore not found on PATH"
command -v aws >/dev/null        || fail "aws not found on PATH"

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
NAME="vega-${STAMP}.dump"
WORKDIR="$(mktemp -d)"
LOCAL="${WORKDIR}/${NAME}"
trap 'rm -rf "$WORKDIR"' EXIT

echo "backup-db: dumping at ${STAMP}"

# Custom format: compressed already, restorable table-by-table, and
# `pg_restore --list` can read its table of contents without a server, which
# is what makes the integrity check below possible at all.
#
# --no-owner / --no-privileges: the roles on the restore target are not the
# roles here, and a dump that refuses to load because `neondb_owner` does not
# exist is a backup that fails at the only moment it is needed.
pg_dump "$BACKUP_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file "$LOCAL"

SIZE=$(wc -c < "$LOCAL")
[ "$SIZE" -ge "$MIN_BYTES" ] || fail "dump is only ${SIZE} bytes; refusing to upload it"

# Read the table of contents back. This is the difference between "pg_dump
# exited 0" and "there is a restorable file here": a truncated or half-written
# dump fails to list.
TOC="$(pg_restore --list "$LOCAL")" || fail "dump is not readable by pg_restore"

# The tables whose loss is unrecoverable. `room_snapshots` above all: it holds
# the canonical state of every board and is overwritten in place.
for table in rooms room_snapshots room_updates media_refs schema_migrations; do
  echo "$TOC" | grep -q "TABLE DATA public ${table}" \
    || fail "dump contains no data for '${table}'; refusing to upload it"
done

echo "backup-db: ${NAME} is ${SIZE} bytes and lists all expected tables"

KEY="s3://${R2_BUCKET}/${PREFIX}/${NAME}"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "backup-db: --dry-run, not uploading to ${KEY}"
  exit 0
fi

aws s3 cp "$LOCAL" "$KEY" --endpoint-url "$R2_ENDPOINT" --only-show-errors
echo "backup-db: uploaded ${KEY}"

# Retention by count, not by date arithmetic.
#
# The names are ISO-8601 with a fixed prefix, so lexical order *is*
# chronological order and "keep the newest N" needs no clock, no timezone and
# no parsing. A date-math version of this is where retention scripts acquire
# the bug that deletes everything.
ALL="$(aws s3api list-objects-v2 \
  --bucket "$R2_BUCKET" --prefix "${PREFIX}/" \
  --endpoint-url "$R2_ENDPOINT" \
  --query 'sort_by(Contents, &Key)[].Key' --output text 2>/dev/null || true)"

# `output text` gives one tab-separated line; split it, drop AWS's "None".
STALE="$(printf '%s' "$ALL" | tr '\t' '\n' | grep -v '^None$' | grep -v '^$' | head -n -"${KEEP}" || true)"

if [ -z "$STALE" ]; then
  echo "backup-db: nothing to prune (keeping ${KEEP})"
else
  echo "$STALE" | while read -r key; do
    [ -n "$key" ] || continue
    aws s3 rm "s3://${R2_BUCKET}/${key}" --endpoint-url "$R2_ENDPOINT" --only-show-errors
    echo "backup-db: pruned ${key}"
  done
fi

echo "backup-db: done"
