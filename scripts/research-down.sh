#!/bin/bash
# Tear down the local stack started by `pnpm research`:
#   - stop the cloudflared tunnel
#   - stop the ngrok tunnel (MinIO / S3)
#   - stop the local api-server
# (Leaves docker / Postgres / MinIO running; stop those with `docker-compose down`.)
set -uo pipefail

echo "==> Stopping ngrok tunnel (MinIO)"
if [ -f /tmp/ngrok.pid ]; then
  kill "$(cat /tmp/ngrok.pid)" 2>/dev/null || true
  rm -f /tmp/ngrok.pid
fi
pkill -f "ngrok http 9000" 2>/dev/null || true

echo "==> Stopping cloudflared tunnel"
if [ -f /tmp/cloudflared.pid ]; then
  kill "$(cat /tmp/cloudflared.pid)" 2>/dev/null || true
  rm -f /tmp/cloudflared.pid
fi
pkill -f "cloudflared tunnel" 2>/dev/null || true

echo "==> Stopping api-server"
if [ -f /tmp/api-server.pid ]; then
  kill "$(cat /tmp/api-server.pid)" 2>/dev/null || true
  rm -f /tmp/api-server.pid
fi
pkill -f "tsx artifacts/api-server/src/index.ts" 2>/dev/null || true

echo "==> Done. (Postgres/MinIO still running; 'docker-compose down' to stop them.)"
