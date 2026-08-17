#!/bin/bash

echo "Starting Docker services..."
docker-compose up -d

echo "Waiting for services to be ready..."
sleep 5

echo "Setting up MinIO..."
docker-compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin 2>/dev/null || true

echo "Creating buckets..."
docker-compose exec minio mc mb local/mednexus 2>/dev/null || echo "Bucket mednexus already exists"
docker-compose exec minio mc mb local/mednexus/radiology-public 2>/dev/null || echo "Bucket radiology-public already exists"
docker-compose exec minio mc mb local/mednexus/radiology-objects 2>/dev/null || echo "Bucket radiology-objects already exists"

echo ""
echo "Done! Services are ready."
echo "PostgreSQL: postgresql://postgres:postgres@localhost:5432/mednexus"
echo "MinIO API: http://localhost:9000"
echo "MinIO Console: http://localhost:9001 (login: minioadmin/minioadmin)"