#!/bin/bash
# Set production secrets for the research Worker on research-center.fit.
# Prompts for each value (input is hidden). Re-run any time to rotate.
set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"
ENV=production

put_secret() {
  local name="$1"
  local prompt="$2"
  local value
  echo ""
  read -r -s -p "$prompt: " value
  echo ""
  if [ -z "$value" ]; then
    echo "Skipped $name (empty input)."
    return
  fi
  echo "$value" | wrangler secret put "$name" --env "$ENV"
}

put_secret S3_ENDPOINT      "S3 endpoint (e.g. https://<id>.r2.cloudflarestorage.com or http://host:9000):"
put_secret S3_ACCESS_KEY_ID "S3 access key id:"
put_secret S3_SECRET_ACCESS_KEY "S3 secret access key:"
put_secret SESSION_SECRET   "SESSION_SECRET (any long random string):"
put_secret GROQ_API_KEY     "GROQ_API_KEY (optional, for voice — leave empty to skip):"
