#!/bin/bash
# Build the frontend and deploy the research Cloudflare Worker to research-center.fit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Installing frontend deps"
( cd artifacts/research-data && pnpm install )

echo "==> Building frontend (BASE_PATH=/)"
( cd artifacts/research-data && BASE_PATH=/ pnpm run build )

echo "==> Syncing build into research/public"
rm -rf research/public/assets research/public/index.html research/public/favicon.svg research/public/robots.txt research/public/_commonjs-dynamic-modules.js 2>/dev/null || true
cp -r artifacts/research-data/dist/public/. research/public/

echo "==> Deploying worker (env: production)"
( cd research && pnpm install && pnpm exec wrangler deploy --env production )

echo "==> Done. Live at https://research-center.fit/"
