#!/bin/bash
# Local development environment: docker services (Postgres + MinIO) + the
# api-server (:4000) + the research-data SPA (:4004). Port scheme is the
# repo-wide one documented in README.md ("Ports") and package.json `dev:apps`:
#   4000 api-server   4003 mockup-sandbox   4004 research-data SPA
#   8080 nginx proxy in front of the api-server (tunnel-run / research deploy)
#   9000 MinIO S3     9001 MinIO console    (127.0.0.1 only — see docker-compose.yml)
set -euo pipefail
trap '' PIPE

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Shared configuration comes from the repo-root .env (copy .env.example ->
# .env) and then from the api-server's own .env, which is where its variables
# (including PUBLIC_OBJECT_SEARCH_PATHS / PRIVATE_OBJECT_DIR) are documented
# and normally configured. This script previously hardcoded both prefixes,
# which contradicted .env.example and scripts/research-deploy.sh — those two
# overrides are gone, so the prefixes now have a single source of truth. The
# explicit per-process values below still win, so `pnpm dev` works with neither
# file present.
for env_file in .env artifacts/api-server/.env; do
  if [ -f "$env_file" ]; then
    # `set +u` while sourcing: unquoted bcrypt hashes (APP_PASSWORD_HASH=$2b$12$…)
    # look like positional-parameter references to bash, and `set -u` would
    # abort the script on the very first such line.
    set +u
    set -a
    # shellcheck disable=SC1090
    . "./$env_file"
    set +a
    set -u
  fi
done

echo "=== Starting MedNexus Development Environment ==="
echo ""

echo "Freeing local dev ports 4000-4005..."
# Kill by listening port only. The previous `pkill -f tsx` / `pkill -f "vite dev"`
# matched every tsx/vite process on the machine, including unrelated projects
# and any production api-server (e.g. one started by `pnpm research`).
for port in 4000 4001 4002 4003 4004 4005; do
  fuser -k "$port/tcp" 2>/dev/null || true
done

sleep 2

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
echo ""
echo "Starting Docker services ($DC)..."
$DC up -d

echo ""
echo "Waiting for services to be ready..."
pnpm run wait-for-services

echo ""
echo "Starting development servers..."
echo "  - API Server (port 4000): real server with S3 presigned URLs"
echo "  - Frontend (port 4004): proxies API calls to localhost:4000"

# Start api-server first (provides proper signed URLs).
# PORT and ALLOWED_ORIGINS are pinned (not taken from the env files) so the dev
# port scheme can never be changed by a stray PORT= in a .env; everything else
# falls back to a dev value only when unset.
PORT=4000 \
  DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/mednexus}" \
  SESSION_SECRET="${SESSION_SECRET:-dev-secret}" \
  NODE_ENV="development" \
  ALLOWED_ORIGINS="http://localhost:4003,http://localhost:4004,http://127.0.0.1:4003,http://127.0.0.1:4004" \
  APP_USERNAME="admin" APP_PASSWORD_HASH='$2b$10$your-bcrypt-hash-here' \
   S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}" \
   S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-minioadmin}" \
   S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-minioadmin}" \
   S3_BUCKET="${S3_BUCKET:-mednexus}" S3_FORCE_PATH_STYLE="true" \
   npx tsx artifacts/api-server/src/index.ts &

# Wait for api-server to start
sleep 3

# Start frontend (proxies /api to the API server on localhost:4000)
API_PROXY_TARGET="${API_PROXY_TARGET:-http://localhost:4000}" \
  npx vite dev artifacts/research-data --host 0.0.0.0 --port 4004 &

echo ""
echo "✓ Development environment started!"
echo "  - Frontend: http://localhost:4004"
echo "  - API: http://localhost:4000"
echo "  - MinIO: http://127.0.0.1:9000 (console not published; see docker-compose.yml)"