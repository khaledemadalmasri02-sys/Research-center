# Storage Architecture & Migration Guide

## Overview

This document describes the image storage architecture and provides guidance for migration from existing storage solutions.

## Current Architecture

```text
Frontend
   ↓
Backend API
   ├── Database → metadata (patient_id, object_key, file info)
   └── MinIO/S3 → actual image files
       ├── radiology-public/  (publicly accessible)
       └── radiology-objects/uploads/  (private, authenticated access)
```

## Object Naming Convention

### Upload Flow

1. Client requests a presigned URL via `POST /api/storage/uploads/request-url`
2. Backend generates unique object key and returns presigned PUT URL
3. Client uploads directly to S3 using the presigned URL
4. Backend stores metadata in database

### Object Key Structure

```
radiology-objects/uploads/{uuid}-{timestamp}-{filename}
radiology-public/{some-public-id}
```

Example:
```
radiology-objects/uploads/a1b2c3d4-1690123456789-xray.jpg
```

## Database Schema

### radiology_images Table

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| patient_id | integer | Foreign key to patients |
| study_id | text | Patient study identifier |
| object_key | text | S3 object key |
| original_filename | text | Original uploaded filename |
| mime_type | text | Image MIME type |
| file_size | integer | File size in bytes |
| etag | text | S3 ETag for verification |
| upload_timestamp | timestamp | When file was uploaded |
| metadata | json | Additional metadata |

### Legacy Fields (Backwards Compatibility)

- `radiologyImageFilePathOrLink` - Single image path/link
- `radiologyImages` - JSON array of paths

These are preserved for backwards compatibility but new uploads store object keys in the dedicated table or as `/objects/...` paths.

## Image Retrieval

### Options

**Option A: Backend Streaming**
```
GET /api/radiology-images/:id
   ↓
Backend validates auth
   ↓
S3/MinIO
   ↓
Image stream to client
```

**Option B: Presigned URLs (Recommended)**
```
GET /api/radiology-images/:id/url
   ↓
Backend validates auth
   ↓
Generate presigned S3 URL
   ↓
Client downloads directly from S3
```

Presigned URLs are used by default with 300-second TTL.

## File Validation

Files are validated before upload:

- MIME type check (via `Content-Type` header)
- File size limit (configurable via `MAX_IMAGE_SIZE_MB`)
- Extension verification

## Migration from Existing Storage

### For Base64 Images in Database

```bash
# Run migration script
tsx scripts/migrate-images.ts
```

Migration flow:
1. Find records with Base64 image data
2. Decode image to binary
3. Generate safe object key
4. Upload to MinIO
5. Verify upload
6. Update database record
7. Log results (do NOT delete old data automatically)

### Migration Script Location

`scripts/migrate-images.ts` - Handles backwards-compatible migration

## Security Considerations

### Never Store Sensitive Data In:
- Object keys (use UUIDs)
- Filenames (sanitize or replace)

### Always:
- Verify user authorization before object access
- Use short-lived presigned URLs (default: 5 minutes)
- Never expose S3 credentials to frontend
- Set appropriate bucket policies

## Switching Storage Backends

### From MinIO to Cloudflare R2

1. Update `.env`:
   ```env
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_ACCESS_KEY_ID=<access-key-id>
   S3_SECRET_ACCESS_KEY=<secret-access-key>
   S3_BUCKET=<bucket-name>
   S3_REGION=auto  # R2 specific
   ```

2. Create bucket in R2 dashboard

3. No code changes required - same S3-compatible API

### From R2 to MinIO

1. Update `.env`:
   ```env
   S3_ENDPOINT=http://localhost:9000
   S3_ACCESS_KEY_ID=minioadmin
   S3_SECRET_ACCESS_KEY=minioadmin
   S3_BUCKET=mednexus
   ```

2. Create bucket:
   ```bash
   docker exec -it mednexus-minio mc mb local/mednexus
   ```

## Backup Considerations

### Database
```bash
pg_dump -h localhost -U postgres mednexus > backup.sql
```

### MinIO Data
```bash
# Depends on volume configuration
docker exec minio mc export local > minio-backup.tar
```

## Troubleshooting

### "Bucket not found" error
```bash
# Check bucket exists
docker compose exec minio mc ls local/mednexus

# Create if missing
docker compose exec minio mc mb local/mednexus
```

### "Access denied" on upload
1. Verify credentials in `.env`
2. Check bucket policy allows writes
3. Verify user has appropriate MinIO permissions

### Invalid presigned URL
1. Check URL expiration (default: 5 minutes)
2. Verify Content-Type header matches upload request
3. Check S3_REGION matches bucket region

## Testing Storage

### Upload test
```bash
# Request upload URL
curl -X POST http://localhost:3004/api/storage/uploads/request-url \
  -H "Content-Type: application/json" \
  -d '{"name":"test.jpg","size":1024,"contentType":"image/jpeg"}' \
  -b "session=..."
```

### Download test
```bash
# Get object via streaming
curl http://localhost:3004/api/storage/objects/uploads/test-uuid

# Get presigned URL for external download
curl http://localhost:3004/api/storage/presigned-url/mednexus/radiology-objects/uploads/test-uuid
```

### Health check
```bash
curl http://localhost:3004/api/storage/health
# Expected: {"status": "ok", "storage": "healthy"}
```