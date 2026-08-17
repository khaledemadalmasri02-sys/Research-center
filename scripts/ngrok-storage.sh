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
# Usage:
#   pnpm run ngrok                                  # free tier: random ngrok URL (auto-detected)
#   NGROK_DOMAIN=your-name.ngrok.dev pnpm run ngrok # reserved/static domain
#
# Prereqs:
#   - ngrok installed and authed (`ngrok config add-authtoken ...`)
#   - docker + docker-compose available
#   - MinIO creds match docker-compose (minioadmin/minioadmin by default)
#
# Note: a free-tier ngrok URL changes on every restart, so re-run this script
# (and restart wrangler dev) whenever ngrok is restarted.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NGROK_DOMAIN="${NGROK_DOMAIN:-}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"
S3_BUCKET="${S3_BUCKET:-mednexus}"
S3_REGION="${S3_REGION:-auto}"
ENV_FILE="$ROOT/research/.env"

command -v ngrok >/dev/null 2>&1 || { echo "ERROR: ngrok is not installed / not on PATH" >&2; exit 1; }

echo "==> 1/5 Starting MinIO (docker-compose)"
docker-compose up -d

echo "==> 2/5 Waiting for MinIO to be ready"
for _ in $(seq 1 60); do
  if curl -fsS -u "$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD" http://localhost:9000/minio/health/live >/dev/null 2>&1; then
    echo "    MinIO is live."
    break
  fi
  sleep 1
done

echo "==> 3/5 Creating bucket '$S3_BUCKET' in MinIO"
docker-compose exec -T minio mc alias set local "http://localhost:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1 || true
docker-compose exec -T minio mc mb --ignore-existing "local/$S3_BUCKET" 2>/dev/null || echo "    (bucket may already exist)"
docker-compose exec -T minio mc mb --ignore-existing "local/$S3_BUCKET/radiology-public" 2>/dev/null || true
docker-compose exec -T minio mc mb --ignore-existing "local/$S3_BUCKET/radiology-objects" 2>/dev/null || true

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
