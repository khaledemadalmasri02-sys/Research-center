#!/usr/bin/env bash
#
# pnpm run ngrok
#
# One-shot setup that wires local MinIO S3 storage to the worker through an
# ngrok tunnel on a RESERVED/STATIC ngrok domain:
#   1. start MinIO (docker-compose)
#   2. wait for MinIO to be healthy
#   3. create the `mednexus` bucket (+ legacy prefixes)
#   4. start `ngrok http 9000 --domain=<reserved>` in the background
#   5. write the resulting S3 endpoint/credentials into research/.env
#
# !! THIS SCRIPT PUBLISHES THE PHI BUCKET TO THE PUBLIC INTERNET.          !!
# !! MinIO holds radiology images, patient documents, database dumps and    !!
# !! backups. An ngrok URL is a public URL: with the S3 root credentials the  !!
# !! holder can list, read and write every object. It is therefore DISABLED  !!
# !! unless you explicitly acknowledge the risk and supply non-default      !!
# !! credentials:                                                          !!
# !!   ALLOW_PUBLIC_MINIO_TUNNEL=1 \                                        !!
# !!   MINIO_ROOT_USER=… MINIO_ROOT_PASSWORD=… pnpm run ngrok              !!
# !! The supported production path needs none of this: `pnpm research` puts  !!
# !! MinIO behind an nginx proxy that 404s every non-/api path, and the SPA  !!
# !! reaches objects through api-server-issued presigned URLs.              !!
#
# Usage:
#   ALLOW_PUBLIC_MINIO_TUNNEL=1 pnpm run ngrok                                  # free tier: random ngrok URL
#   NGROK_DOMAIN=your-name.ngrok.dev … pnpm run ngrok                           # reserved/static domain
#
# Prereqs:
#   - ngrok installed and authed (`ngrok config add-authtoken ...`)
#   - docker + docker compose available
#
# Note: a free-tier ngrok URL changes on every restart, so re-run this script
# (and restart wrangler dev) whenever ngrok is restarted.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "${ALLOW_PUBLIC_MINIO_TUNNEL:-}" != "1" ]; then
  cat >&2 <<'MSG'
ERROR: scripts/ngrok-storage.sh is disabled by default.

It would put the MinIO S3 endpoint — the bucket holding radiology images,
patient documents, database dumps and backups — behind a PUBLIC ngrok URL.
The same exposure was removed from the production nginx proxy (which now
returns 404 for every non-/api path), so this script must not silently
reintroduce it.

If you genuinely need a temporary public S3 endpoint (e.g. wrangler dev on
another machine), re-run it with an explicit acknowledgement and non-default
credentials:

  ALLOW_PUBLIC_MINIO_TUNNEL=1 \
  MINIO_ROOT_USER=<user> MINIO_ROOT_PASSWORD=<password> pnpm run ngrok
MSG
  exit 1
fi

NGROK_DOMAIN="${NGROK_DOMAIN:-}"
# No silent fallback to minioadmin/minioadmin: a public tunnel plus published
# default credentials is an unauthenticated PHI bucket.
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER must be set (the minioadmin default is not acceptable for a public tunnel)}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD must be set}"
case "${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}" in
  minioadmin:minioadmin)
    echo "ERROR: refusing to publish MinIO with the default minioadmin credentials." >&2
    exit 1
    ;;
esac
S3_BUCKET="${S3_BUCKET:-mednexus}"
S3_REGION="${S3_REGION:-auto}"
ENV_FILE="$ROOT/research/.env"

command -v ngrok >/dev/null 2>&1 || { echo "ERROR: ngrok is not installed / not on PATH" >&2; exit 1; }
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

echo "==> 1/5 Starting MinIO ($DC)"
$DC up -d

echo "==> 2/5 Waiting for MinIO to be ready"
for _ in $(seq 1 60); do
  if curl -fsS -u "$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD" http://localhost:9000/minio/health/live >/dev/null 2>&1; then
    echo "    MinIO is live."
    break
  fi
  sleep 1
done

echo "==> 3/5 Creating bucket '$S3_BUCKET' in MinIO"
$DC exec -T minio mc alias set local "http://localhost:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1 || true
$DC exec -T minio mc mb --ignore-existing "local/$S3_BUCKET" 2>/dev/null || echo "    (bucket may already exist)"
$DC exec -T minio mc mb --ignore-existing "local/$S3_BUCKET/radiology-public" 2>/dev/null || true
$DC exec -T minio mc mb --ignore-existing "local/$S3_BUCKET/radiology-objects" 2>/dev/null || true

echo "==> 4/5 Starting ngrok tunnel${NGROK_DOMAIN:+ (reserved domain: $NGROK_DOMAIN)}"
ngrok http 9000 ${NGROK_DOMAIN:+--url="https://$NGROK_DOMAIN"} > /tmp/ngrok-storage.log 2>&1 &
NGROK_PID=$!
echo "    ngrok PID=$NGROK_PID (log: /tmp/ngrok-storage.log)"

# Read the assigned public URL from ngrok's local API (:4040). This works for
# both reserved domains and the random free-tier URL.
echo "    waiting for ngrok public URL..."
S3_ENDPOINT=""
for _ in $(seq 1 30); do
  S3_ENDPOINT=$(curl -fsS http://localhost:4040/api/tunnels 2>/dev/null \
    | grep -o '"public_url":"https://[^"]*"' | head -1 \
    | sed 's/"public_url":"//; s/"$//')
  [[ -n "$S3_ENDPOINT" ]] && break
  sleep 1
done

if [[ -z "$S3_ENDPOINT" ]]; then
  echo "ERROR: could not determine ngrok public URL." >&2
  echo "------- ngrok log -------" >&2
  cat /tmp/ngrok-storage.log >&2
  echo "-------------------------" >&2
  echo "Tip: ensure ngrok is authed (ngrok config add-authtoken <token>) and that" >&2
  echo "     the reserved domain is claimed by YOUR ngrok account." >&2
  kill "$NGROK_PID" 2>/dev/null || true
  exit 1
fi
echo "    ngrok URL: $S3_ENDPOINT"

echo "==> 5/5 Writing S3 config into $ENV_FILE"
set_value() {
  local key="$1" val="$2"
  if grep -q "^$key=" "$ENV_FILE"; then
    sed -i "s|^$key=.*|$key=$val|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}
set_value S3_ENDPOINT "$S3_ENDPOINT"
set_value S3_ACCESS_KEY_ID "$MINIO_ROOT_USER"
set_value S3_SECRET_ACCESS_KEY "$MINIO_ROOT_PASSWORD"
set_value S3_BUCKET "$S3_BUCKET"
set_value S3_REGION "$S3_REGION"

echo
echo "DONE."
echo "  S3 endpoint : $S3_ENDPOINT"
echo "  Bucket      : $S3_BUCKET"
echo "  Access key  : $MINIO_ROOT_USER"
echo
echo "Next steps:"
echo "  - Restart 'wrangler dev' (or redeploy) so it reloads research/.env"
echo "  - ngrok is running in the background (PID $NGROK_PID). Stop it with: kill $NGROK_PID"
