#!/usr/bin/env bash
# Apply the D1 schema with retry-on-transient-auth.
# Cloudflare's D1 /import endpoint occasionally returns "Authentication error [code: 10000]"
# for OAuth tokens even when /execute (small SQL) works — almost always transient. We retry
# a handful of times with a small backoff before giving up.
#
# Usage:
#   scripts/with-d1-retry.sh [<extra wrangler args>...]
# Defaults to the production schema apply if no args are passed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/research"

ARGS=("$@")
if [ "${#ARGS[@]}" -eq 0 ]; then
  ARGS=(wrangler d1 execute mednexus-research --env production --remote --file=./schema.sql)
fi

MAX_ATTEMPTS="${D1_MAX_ATTEMPTS:-5}"
SLEEP_SECONDS="${D1_RETRY_SLEEP:-3}"

attempt=1
while true; do
  echo "==> D1 attempt $attempt/$MAX_ATTEMPTS: ${ARGS[*]}"
  if pnpm exec "${ARGS[@]}"; then
    exit 0
  fi
  rc=$?
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "D1 apply failed after $MAX_ATTEMPTS attempts (exit $rc)." >&2
    exit "$rc"
  fi
  echo "D1 attempt $attempt failed (exit $rc); retrying in ${SLEEP_SECONDS}s..." >&2
  sleep "$SLEEP_SECONDS"
  attempt=$((attempt + 1))
done