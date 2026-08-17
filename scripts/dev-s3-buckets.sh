#!/bin/bash

echo "Setting up MinIO..."
docker-compose exec -T minio mc alias set local http://localhost:9000 minioadmin minioadmin 2>/dev/null || true

echo "Creating buckets..."
docker-compose exec -T minio mc mb local/mednexus 2>/dev/null || echo "Bucket mednexus already exists"
docker-compose exec -T minio mc mb local/mednexus/radiology-public 2>/dev/null || echo "Bucket radiology-public already exists"
docker-compose exec -T minio mc mb local/mednexus/radiology-objects 2>/dev/null || echo "Bucket radiology-objects already exists"

echo "S3 setup complete!"