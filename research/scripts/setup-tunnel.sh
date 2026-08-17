#!/bin/bash
# Full local tunnel — brings up MinIO + the local D1 database, then runs the
# local Worker and a cloudflared tunnel so research-center.fit is served from
# your machine. One command, no manual steps.
set -uo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(cd .. && pwd)"
WRANGLER="./node_modules/.bin/wrangler"
PORT=8787

# Docker Compose: prefer the v2 plugin, fall back to the standalone binary.
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

log() { echo "[tunnel] $*"; }

log "=== Research local tunnel (full auto) ==="

# 1) MinIO (S3) — start if we can, otherwise assume it is already running.
log "Starting MinIO (Docker)…"
( cd "$REPO_ROOT" && $DC up -d minio ) || log "Docker unavailable — assuming MinIO is already running on :9000"

for i in $(seq 1 30); do
  if curl -fs http://localhost:9000/minio/health/live >/dev/null 2>&1; then break; fi
  sleep 1
done

# 2) Buckets.
log "Ensuring MinIO buckets…"
( cd "$REPO_ROOT" && \
  $DC exec -T minio mc alias set local http://localhost:9000 minioadmin minioadmin >/dev/null 2>&1 || true
  $DC exec -T minio mc mb local/mednexus >/dev/null 2>&1 || true
  $DC exec -T minio mc mb local/mednexus/radiology-public >/dev/null 2>&1 || true
  $DC exec -T minio mc mb local/mednexus/radiology-objects >/dev/null 2>&1 || true ) \
  || log "Bucket setup skipped (mc not available)."

# 3) Local D1 schema.
log "Applying local D1 schema…"
"$WRANGLER" d1 execute mednexus-research --local --file=./schema.sql >/dev/null 2>&1 \
  || log "D1 schema already applied or skipped."

# 4) Tunnel + DNS.
if ! command -v cloudflared >/dev/null 2>&1; then
  log "cloudflared not found. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi
if cloudflared tunnel list 2>/dev/null | grep -q "research-tunnel"; then
  log "Tunnel 'research-tunnel' exists."
else
  log "Creating tunnel 'research-tunnel'…"
  cloudflared tunnel create research-tunnel
  cloudflared tunnel route dns research-tunnel research-center.fit 2>/dev/null \
    || log "DNS route may need manual setup."
fi

# 5) Launch the local Worker and the tunnel, side by side.
cleanup() {
  echo ""
  log "Shutting down…"
  [ -n "${DEV_PID:-}" ] && kill "$DEV_PID" 2>/dev/null || true
  [ -n "${TUN_PID:-}" ] && kill "$TUN_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# The Worker runs locally, so it can reach MinIO directly at localhost:9000
# (no ngrok dependency needed for the tunnel workflow).
log "Starting local Worker on :$PORT…"
S3_ENDPOINT=http://localhost:9000 S3_ACCESS_KEY_ID=minioadmin S3_SECRET_ACCESS_KEY=minioadmin \
  "$WRANGLER" dev --local --port "$PORT" > /tmp/kilo/worker-dev.log 2>&1 &
DEV_PID=$!

log "Starting cloudflared tunnel…"
cloudflared tunnel run --config "$PWD/tunnel-config.yml" research-tunnel &
TUN_PID=$!

echo ""
log "research-center.fit -> local Worker (http://localhost:$PORT)"
log "Worker logs: tail -f /tmp/kilo/worker-dev.log"
log "Press Ctrl+C to stop."
wait
