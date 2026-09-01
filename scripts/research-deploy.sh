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
#   5. Build the React SPA (research/ui) into research/public
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
# Ignore SIGPIPE: when the launcher's output stream closes early (common in
# CI/tooling wrappers), a bare `echo` would otherwise terminate the script
# with exit code 141. Ignoring it lets the deploy finish.
trap '' PIPE

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-3000}"
MINIO_PORT="${MINIO_PORT:-9000}"
PROXY_PORT="${PROXY_PORT:-8080}"
TUNNEL_CONFIG="${TUNNEL_CONFIG:-$HOME/.cloudflared/research-api.yml}"
TUNNEL_NAME="${TUNNEL_NAME:-research-api}"
KILO="${KILO_DIR:-/tmp/kilo}"
mkdir -p "$KILO"

# Admin credentials: never hardcode. Prefer ADMIN_PASSWORD from the environment;
# otherwise generate a random password and print it (saved to $KILO/admin-credentials.txt).
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  ADMIN_HASH="$(node -e "const b=require('bcryptjs');process.stdout.write(b.hashSync(process.argv[1],12))" "$ADMIN_PASSWORD")"
  echo "Using admin password from ADMIN_PASSWORD env."
elif [ -n "${ADMIN_HASH:-}" ]; then
  : # explicit ADMIN_HASH already provided via environment
elif [ -s "$KILO/admin-credentials.txt" ]; then
  # Reuse the password from a previous run so logins stay stable across deploys
  # (otherwise every `pnpm research` would randomize it and break admin login).
  GEN_PASS="$(cat "$KILO/admin-credentials.txt")"
  ADMIN_HASH="$(node -e "const b=require('bcryptjs');process.stdout.write(b.hashSync(process.argv[1],12))" "$GEN_PASS")"
  echo "Reusing existing admin password from $KILO/admin-credentials.txt"
else
  GEN_PASS="$(head -c 32 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 16)"
  ADMIN_HASH="$(node -e "const b=require('bcryptjs');process.stdout.write(b.hashSync(process.argv[1],12))" "$GEN_PASS")"
  echo "$GEN_PASS" > "$KILO/admin-credentials.txt"
  echo "Generated admin password (save this): $GEN_PASS"
fi

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
# Strong session secret: from env if provided, otherwise a fresh random value.
export SESSION_SECRET="${SESSION_SECRET:-$(head -c 64 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 48)}"
# Strict CORS: only these origins may call the API (also activates the CSRF
# Origin guard). Override with ALLOWED_ORIGINS for other domains.
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://research-center.fit,https://www.research-center.fit,https://api.research-center.fit}"
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
export NODE_ENV="production"
# Outbound email via Brevo: load the SMTP credentials from the api-server's own
# .env. Without these, sendEmail() silently no-ops (returns false) and OTP /
# notification emails are never sent. Only the SMTP_* lines are sourced so we
# don't clobber PORT / DATABASE_URL already exported above.
set -a
. <(grep -E '^(SMTP_|UNSUBSCRIBE_STATUS_TOKEN|MAIL_)' artifacts/api-server/.env 2>/dev/null || true)
set +a
setsid nohup pnpm exec tsx artifacts/api-server/src/index.ts > "$KILO/api-server.log" 2>&1 &
echo $! > "$KILO/api-server.pid"
for i in $(seq 1 60); do
  if curl -sf "http://localhost:$API_PORT/api/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -sf "http://localhost:$API_PORT/api/healthz" >/dev/null 2>&1 || { echo "ERROR: api-server did not start (see $KILO/api-server.log)"; exit 1; }

# 5. Build the legacy SPA (artifacts/research-data -> research/public).
#    This is the production UI/UX. It now ALSO includes the new feature modules
#    (consent, deidentify, coding, cohort, validation, dicom, export, studies,
#    ml, reports, gdpr, ingest, search) surfaced via the "More features" page.
echo "==> Building frontend (artifacts/research-data -> research/public)"
( cd artifacts/research-data && pnpm install && BASE_PATH=/ pnpm run build )
echo "==> Syncing build into research/public"
rm -rf research/public/assets research/public/index.html research/public/favicon.svg research/public/robots.txt research/public/_commonjs-dynamic-modules.js 2>/dev/null || true
cp -r artifacts/research-data/dist/public/. research/public/

# 6. Apply the D1 schema (idempotent CREATE TABLE IF NOT EXISTS) and point the
#    Worker at the tunnel, then deploy. The schema bootstrap is also re-run
#    lazily on the Worker's first request, but applying it here keeps the
#    database in lockstep with the source-controlled schema.sql (so tables
#    like email_unsubscribes exist on the first hit rather than the first
#    request creating them).
echo "==> Applying D1 schema migration"
( cd research && pnpm exec wrangler d1 execute mednexus-research --env production --remote --file=./schema.sql )

echo "==> Setting Worker secret API_BACKEND_URL = https://api.research-center.fit"
( cd research && \
  pnpm install && \
  printf '%s' "https://api.research-center.fit" | pnpm exec wrangler secret put --env production API_BACKEND_URL && \
  pnpm exec wrangler deploy --env production )

# 6b. Optional: also set UNSUBSCRIBE_STATUS_TOKEN on the Worker so the
#     api-server's pre-send unsubscribe guard can authenticate against
#     /api/unsubscribe/status. Sourced from the api-server's own .env (same
#     pattern as the SMTP_* lines above). If unset, the Worker serves the
#     status endpoint unauthenticated — fine for dev, not recommended in
#     production.
if [ -n "${UNSUBSCRIBE_STATUS_TOKEN:-}" ]; then
  echo "==> Setting Worker secret UNSUBSCRIBE_STATUS_TOKEN (from env)"
  ( cd research && \
    printf '%s' "$UNSUBSCRIBE_STATUS_TOKEN" | pnpm exec wrangler secret put --env production UNSUBSCRIBE_STATUS_TOKEN )
else
  echo "==> Skipping UNSUBSCRIBE_STATUS_TOKEN (not set). To enable pre-send"
  echo "    unsubscribe enforcement, add to artifacts/api-server/.env:"
  echo "      UNSUBSCRIBE_STATUS_TOKEN=<32-byte random>"
  echo "      MAIL_UNSUBSCRIBE_LOOKUP_URL=https://research-center.fit"
  echo "      MAIL_UNSUBSCRIBE_LOOKUP_TOKEN=<same 32-byte random>"
fi

echo ""
echo "==> DONE. research-center.fit proxies /api -> https://api.research-center.fit -> local api-server."
echo "    Logs: $KILO/{cloudflared,nginx-proxy,api-server}.log"
echo "    Stop everything later with:  pnpm research:down"
