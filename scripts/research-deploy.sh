#!/usr/bin/env bash
# Full production deploy of research-center.fit WITH the local api-server behind
# the persistent, named Cloudflare tunnel `research-api` (api.research-center.fit),
# so the domain gets the FULL feature set
# (records, signup, users, admin, feedback, patients) from Postgres + MinIO.
#
# What it does (end to end):
#   1. Start Postgres + MinIO via docker compose
#   2. Start an nginx proxy (:8080) that splits traffic:
#        /api -> api-server:3000,  / -> MinIO:9000
#   3. Start the api-server locally (:3000) with MinIO as local S3
#   4. Start the persistent Cloudflare tunnel `research-api`
#      (config: ~/.cloudflared/research-api.yml) which serves
#      api.research-center.fit -> the nginx proxy above
#   5. Build the SPA (BASE_PATH=/) and sync it into research/public
#   6. Set the Worker secret API_BACKEND_URL = https://api.research-center.fit
#      and deploy the Worker (env: production), which reverse-proxies
#      /api/* -> api.research-center.fit -> tunnel -> api-server
#
# No ngrok dependency. The tunnel must already be created (cloudflared login
# once, and the research-api tunnel + its ingress live in
# ~/.cloudflared/research-api.yml pointing api.research-center.fit ->
# http://localhost:8080). A DNS CNAME api.research-center.fit ->
# <tunnel-id>.cfargotunnel.com (proxied) must exist in the research-center.fit
# Cloudflare zone.
#
# Prerequisites (one-time, manual):
#   - `cloudflared` installed + `cloudflared login` (Cloudflare account)
#   - `wrangler login` (for the Worker deploy)
#   - Docker installed and running
#   - nginx installed
#
# Tear down later with:  pnpm research:down
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-3000}"
MINIO_PORT="${MINIO_PORT:-9000}"
PROXY_PORT="${PROXY_PORT:-8080}"
TUNNEL_CONFIG="${TUNNEL_CONFIG:-$HOME/.cloudflared/research-api.yml}"
TUNNEL_NAME="${TUNNEL_NAME:-research-api}"
KILO="${KILO_DIR:-/tmp/kilo}"
mkdir -p "$KILO"

ADMIN_HASH='REDACTED_BCRYPT_HASH'

# Idempotent: stop any tunnel / proxy / api-server left over from an interrupted run
pkill -f "cloudflared tunnel --config $TUNNEL_CONFIG" 2>/dev/null || true
pkill -f "nginx -c $KILO/nginx-proxy.conf" 2>/dev/null || true
pkill -f "tsx artifacts/api-server/src/index.ts" 2>/dev/null || true
rm -f "$KILO"/*.pid
sleep 1

echo "==> Preflight checks"
command -v cloudflared >/dev/null 2>&1 || { echo "ERROR: cloudflared not found. Install: https://developers.cloudflare.com/cloudflared/"; exit 1; }
command -v nginx >/dev/null 2>&1 || { echo "ERROR: nginx not found."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found."; exit 1; }
[ -f "$TUNNEL_CONFIG" ] || { echo "ERROR: tunnel config not found: $TUNNEL_CONFIG"; exit 1; }

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
echo "    using: $DC"

# 1. Start database + object storage
echo "==> Starting docker (Postgres + MinIO)"
$DC up -d
for i in $(seq 1 60); do
  if $DC exec -T postgres pg_isready -U postgres -d mednexus >/dev/null 2>&1; then break; fi
  sleep 1
done
$DC exec -T postgres pg_isready -U postgres -d mednexus >/dev/null 2>&1 || { echo "ERROR: Postgres did not become ready."; exit 1; }

# 2. Start nginx proxy ($PROXY_PORT: /api -> $API_PORT, / -> $MINIO_PORT)
echo "==> Starting nginx proxy ($PROXY_PORT: /api -> $API_PORT, / -> $MINIO_PORT)"
cat > "$KILO/nginx-proxy.conf" <<NGINX
worker_processes 1;
daemon on;
pid $KILO/nginx-proxy.pid;
error_log $KILO/nginx-proxy-error.log warn;
events { worker_connections 1024; }
http {
  access_log $KILO/nginx-proxy-access.log;
  client_max_body_size 0;
  proxy_request_buffering off;
  upstream apisrv { server 127.0.0.1:$API_PORT; }
  upstream minio { server 127.0.0.1:$MINIO_PORT; }
  server {
    listen $PROXY_PORT;
    location ~ ^/api(/|\$) {
      proxy_pass http://apisrv;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location / {
      proxy_pass http://minio;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
    }
  }
}
NGINX
nginx -c "$KILO/nginx-proxy.conf" -p "$KILO/" 2>&1
sleep 1

# 3. Start the persistent Cloudflare tunnel (api.research-center.fit -> localhost:8080)
echo "==> Starting Cloudflare tunnel ($TUNNEL_NAME -> $PROXY_PORT via nginx)"
setsid nohup cloudflared tunnel --config "$TUNNEL_CONFIG" run "$TUNNEL_NAME" > "$KILO/cloudflared.log" 2>&1 &
echo $! > "$KILO/cloudflared.pid"
for i in $(seq 1 30); do
  if grep -q "Registered tunnel connection" "$KILO/cloudflared.log" 2>/dev/null; then break; fi
  sleep 1
done
grep -q "Registered tunnel connection" "$KILO/cloudflared.log" 2>/dev/null || echo "WARN: tunnel not yet registered (see $KILO/cloudflared.log)"

# 4. Start api-server locally, MinIO as local S3
echo "==> Starting api-server on :$API_PORT (S3 via local MinIO:$MINIO_PORT)"
export PORT="$API_PORT"
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/mednexus"
export SESSION_SECRET="dev-secret"
export APP_USERNAME="admin"
export APP_PASSWORD_HASH="$ADMIN_HASH"
export S3_ENDPOINT="http://localhost:$MINIO_PORT"
export S3_ACCESS_KEY_ID="minioadmin"
export S3_SECRET_ACCESS_KEY="minioadmin"
export S3_BUCKET="mednexus"
export S3_FORCE_PATH_STYLE="true"
export S3_SIGNED_URL_EXPIRES_SECONDS="300"
export PUBLIC_OBJECT_SEARCH_PATHS="/mednexus"
export PRIVATE_OBJECT_DIR="/objects"
export NODE_ENV="development"
setsid nohup pnpm exec tsx artifacts/api-server/src/index.ts > "$KILO/api-server.log" 2>&1 &
echo $! > "$KILO/api-server.pid"
for i in $(seq 1 60); do
  if curl -sf "http://localhost:$API_PORT/api/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -sf "http://localhost:$API_PORT/api/healthz" >/dev/null 2>&1 || { echo "ERROR: api-server did not start (see $KILO/api-server.log)"; exit 1; }

# 5. Build + sync the SPA into research/public
echo "==> Building frontend (BASE_PATH=/)"
( cd artifacts/research-data && pnpm install && BASE_PATH=/ pnpm run build )
echo "==> Syncing build into research/public"
rm -rf research/public/assets research/public/index.html research/public/favicon.svg research/public/robots.txt research/public/_commonjs-dynamic-modules.js 2>/dev/null || true
cp -r artifacts/research-data/dist/public/. research/public/

# 6. Point the Worker at the tunnel and deploy
echo "==> Setting Worker secret API_BACKEND_URL = https://api.research-center.fit"
( cd research && \
  printf '%s' "https://api.research-center.fit" | pnpm exec wrangler secret put --env production API_BACKEND_URL && \
  pnpm install && pnpm exec wrangler deploy --env production )

echo ""
echo "==> DONE. research-center.fit proxies /api -> https://api.research-center.fit -> local api-server."
echo "    Logs: $KILO/{cloudflared,nginx-proxy,api-server}.log"
echo "    Stop everything later with:  pnpm research:down"
