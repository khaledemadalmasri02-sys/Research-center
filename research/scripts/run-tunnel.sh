#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/../tunnel-config.yml"

echo "Starting Cloudflare Tunnel for research-center.fit"
echo ""
echo "Route: research-center.fit/*  ->  local worker dev server (http://localhost:8787)"
echo "Make sure 'pnpm dev' is running before starting the tunnel."
echo ""

cloudflared tunnel run --config "$CONFIG" research-tunnel
