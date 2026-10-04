#!/bin/bash
# Start the docker services (Postgres + MinIO) and create the MinIO buckets.

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-minioadmin}"
S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-minioadmin}"

echo "Starting Docker services..."
$DC up -d

echo "Waiting for services to be ready..."
sleep 5

echo "Setting up MinIO..."
$DC exec minio mc alias set local http://localhost:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" 2>/dev/null || true

echo "Creating buckets..."
$DC exec minio mc mb local/mednexus 2>/dev/null || echo "Bucket mednexus already exists"
$DC exec minio mc mb local/mednexus/radiology-public 2>/dev/null || echo "Bucket radiology-public already exists"
$DC exec minio mc mb local/mednexus/radiology-objects 2>/dev/null || echo "Bucket radiology-objects already exists"

echo ""
echo "Done! Services are ready."
echo "PostgreSQL: postgresql://postgres:postgres@localhost:5432/mednexus"
echo "MinIO API: http://127.0.0.1:9000"
# The console is deliberately NOT published to the host any more (it used to be
# on 0.0.0.0:9001, reachable from the whole network). Use the mc CLI above.
echo "MinIO Console: not published; use 'docker compose exec minio mc ...'"