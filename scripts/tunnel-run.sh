#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# API is served through the persistent Cloudflare tunnel `research-api`
# (config: ~/.cloudflared/research-api.yml). Its ingress points
# api.research-center.fit -> the local nginx proxy on $PROXY_PORT, which
# splits traffic: /api -> api-server, / -> MinIO (S3). No ngrok dependency.
TUNNEL_CONFIG="${TUNNEL_CONFIG:-$HOME/.cloudflared/research-api.yml}"
TUNNEL_NAME="${TUNNEL_NAME:-research-api}"
API_PORT="${API_PORT:-3000}"
MINIO_PORT="${MINIO_PORT:-9000}"
PROXY_PORT="${PROXY_PORT:-8080}"
KILO="${KILO_DIR:-/tmp/kilo}"
mkdir -p "$KILO"

command -v cloudflared >/dev/null 2>&1 || { echo "ERROR: cloudflared not installed"; exit 1; }
command -v nginx >/dev/null 2>&1 || { echo "ERROR: nginx not installed"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not installed"; exit 1; }
[ -f "$TUNNEL_CONFIG" ] || { echo "ERROR: tunnel config not found: $TUNNEL_CONFIG"; exit 1; }

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

echo "==> Tearing down any previous tunnel run"
pkill -f "cloudflared tunnel --config $TUNNEL_CONFIG" 2>/dev/null || true
pkill -f "nginx -c $KILO/nginx-proxy.conf" 2>/dev/null || true
pkill -f "ngrok http $PROXY_PORT" 2>/dev/null || true
pkill -f "artifacts/api-server/src/index.ts" 2>/dev/null || true
rm -f "$KILO"/*.pid
sleep 2

echo "==> 1/5 Starting docker (Postgres + MinIO)"
$DC up -d
for i in $(seq 1 60); do
  if $DC exec -T postgres pg_isready -U postgres -d mednexus >/dev/null 2>&1; then break; fi
  sleep 1
done
$DC exec -T postgres pg_isready -U postgres -d mednexus >/dev/null 2>&1 || { echo "ERROR: Postgres not ready"; exit 1; }

echo "==> 2/5 Starting nginx proxy ($PROXY_PORT: /api -> $API_PORT, / -> $MINIO_PORT)"
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
      proxy_set_header X-Forwarded-Proto https;
    }
    location / {
      proxy_pass http://minio;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto https;
    }
  }
}
NGINX
nginx -c "$KILO/nginx-proxy.conf" -p "$KILO/" 2>&1
sleep 1

echo "==> 3/5 Starting Cloudflare tunnel ($TUNNEL_NAME -> $PROXY_PORT via nginx)"
setsid nohup cloudflared tunnel --config "$TUNNEL_CONFIG" run "$TUNNEL_NAME" > "$KILO/cloudflared.log" 2>&1 &
echo $! > "$KILO/cloudflared.pid"
# Give the tunnel a moment to register with the Cloudflare edge.
for i in $(seq 1 30); do
  if grep -q "Registered tunnel connection" "$KILO/cloudflared.log" 2>/dev/null; then break; fi
  sleep 1
done
grep -q "Registered tunnel connection" "$KILO/cloudflared.log" 2>/dev/null || echo "WARN: tunnel not yet registered (see $KILO/cloudflared.log)"

echo "==> 4/5 Restarting api-server (S3 via local MinIO:9000, served to browser through /api/storage proxy)"
export PORT="$API_PORT"
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/mednexus"
export SESSION_SECRET="dev-secret"
export APP_USERNAME="admin"
export APP_PASSWORD_HASH='REDACTED_BCRYPT_HASH'
export S3_ENDPOINT="http://localhost:9000"
export S3_ACCESS_KEY_ID="minioadmin"
export S3_SECRET_ACCESS_KEY="minioadmin"
export S3_BUCKET="mednexus"
export S3_FORCE_PATH_STYLE="true"
export S3_SIGNED_URL_EXPIRES_SECONDS="300"
export PUBLIC_OBJECT_SEARCH_PATHS="/mednexus"
export PRIVATE_OBJECT_DIR="/mednexus"
export NODE_ENV="development"
setsid nohup pnpm exec tsx artifacts/api-server/src/index.ts > "$KILO/api-server.log" 2>&1 &
echo $! > "$KILO/api-server.pid"
for i in $(seq 1 60); do
  if curl -sf "http://localhost:$API_PORT/api/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -sf "http://localhost:$API_PORT/api/healthz" >/dev/null 2>&1 || { echo "ERROR: api-server did not start (see $KILO/api-server.log)"; exit 1; }

echo "==> 5/5 Applying D1 schema migration"
( cd research && pnpm exec wrangler d1 execute mednexus-research --env production --remote --file=./schema.sql )

echo "==> 5/5 Linking Worker (research-center.fit) to the Cloudflare tunnel"
( cd research && \
  printf '%s' "https://api.research-center.fit" | pnpm exec wrangler secret put --env production API_BACKEND_URL && \
  pnpm install && pnpm exec wrangler deploy --env production )

echo ""
echo "DONE."
echo "  research-center.fit -> Cloudflare tunnel research-api (https://api.research-center.fit)"
echo "  nginx proxy :$PROXY_PORT splits /api -> api-server, / -> MinIO"
echo "  Logs: $KILO/{cloudflared,nginx-proxy,api-server}.log"
