#!/bin/bash
# One-time MinIO bucket setup for local dev.
# Credentials come from the environment (docker-compose.yml passes
# S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY to MinIO as the root user/password),
# falling back to the loopback-only dev defaults.
set -euo pipefail

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-minioadmin}"
S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-minioadmin}"

echo "Setting up MinIO..."
$DC exec -T minio mc alias set local http://localhost:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" 2>/dev/null || true

echo "Creating buckets..."
$DC exec -T minio mc mb local/mednexus 2>/dev/null || echo "Bucket mednexus already exists"
$DC exec -T minio mc mb local/mednexus/radiology-public 2>/dev/null || echo "Bucket radiology-public already exists"
$DC exec -T minio mc mb local/mednexus/radiology-objects 2>/dev/null || echo "Bucket radiology-objects already exists"

echo "S3 setup complete!"