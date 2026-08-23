#!/bin/bash

set -e

echo "=== Starting MedNexus Development Environment ==="
echo ""

echo "Killing existing processes on ports 3000-3005..."
for port in 3000 3001 3002 3003 3004 3005; do
  fuser -k $port/tcp 2>/dev/null || true
done

echo "Killing any remaining tsx/vite/node processes..."
pkill -f "tsx" 2>/dev/null || true
pkill -f "vite dev" 2>/dev/null || true

sleep 2

echo ""
echo "Starting Docker services..."
docker-compose up -d

echo ""
echo "Waiting for services to be ready..."
pnpm run wait-for-services

echo ""
echo "Starting development servers..."
echo "  - API Server (port 3000): real server with S3 presigned URLs"
echo "  - Frontend (port 3004): proxies API calls to localhost:3000"

# Start api-server first (provides proper signed URLs)
PORT=3000 DATABASE_URL="postgresql://postgres:postgres@localhost:5432/mednexus" SESSION_SECRET="dev-secret" \
  APP_USERNAME="admin" APP_PASSWORD_HASH='REDACTED_BCRYPT_HASH' \
  S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY_ID="minioadmin" S3_SECRET_ACCESS_KEY="minioadmin" \
  S3_BUCKET="mednexus" S3_FORCE_PATH_STYLE="true" \
  PUBLIC_OBJECT_SEARCH_PATHS="/mednexus" PRIVATE_OBJECT_DIR="/objects" \
  npx tsx artifacts/api-server/src/index.ts &

# Wait for api-server to start
sleep 3

# Start frontend (proxies /api to the API server on localhost:3000)
API_PROXY_TARGET="http://localhost:3000" \
  npx vite dev artifacts/research-data --host 0.0.0.0 --port 3004 &

echo ""
echo "✓ Development environment started!"
echo "  - Frontend: http://localhost:3004"
echo "  - API: http://localhost:3000"
echo "  - MinIO: http://localhost:9000 (console: 9001)"