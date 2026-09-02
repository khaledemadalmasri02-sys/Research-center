# Storage Architecture

This document describes how the api-server stores and retrieves
radiology images. The conventions here are the **canonical scheme**;
any code that generates a different prefix is a bug.

## TL;DR

- **Single canonical S3 prefix:** `radiology/`
- **Bucket:** whatever `S3_BUCKET` is set to (default `mednexus`)
- **Object key format:** `radiology/<uuid>` for direct uploads,
  `radiology/patient_<id>_<uuid>...` for batched uploads,
  `radiology/<uuid>` again for SSRF imports.
- **Read paths:** `/api/storage/objects/<full-key>` — auth required
  for every key not under the public allowlist (see below).
- **No public bucket prefix in production.** The legacy `radiology-public/`
  and `radiology-objects/` paths described in earlier revisions of this
  document no longer exist. Old buckets can keep the historical data,
  but new code reads/writes only `radiology/`.

## Current Architecture

```text
Frontend
   ↓
api-server (Express)
   ├── Database → metadata (patient_id, object_key, file info)
   └── MinIO/S3 → actual image files
       └── <bucket>/radiology/<object-id>
```

The api-server **owns** the key namespace under `radiology/`. Browsers
never see the bucket directly; every read goes through
`/api/storage/objects/<key>` (auth) or a short-lived presigned URL.

## Object Naming Convention

### Uploads

Three flavours, all under `radiology/`:

| Source           | Format                                       | Used by                                |
| ---------------- | -------------------------------------------- | -------------------------------------- |
| `request-url`    | `radiology/<object-id>`                      | `routes/storage.ts:requestUploadUrl`   |
| `upload-file`    | `radiology/<object-id>`                      | `routes/storage.ts:uploadFile`         |
| `images/import`  | `radiology/<object-id>`                      | `routes/storage.ts:importImage`        |
| `images/batch`   | `radiology/patient_<id>_<uuid>...`           | `routes/storage.ts:batchImportImages`   |

`<object-id>` is a UUIDv4 generated server-side. The full path
returned to the client is what the api-server stored (no
transformation), and it is what the api-server uses to read or
delete the object.

### Reads

`/api/storage/objects/<key>` — every request is authenticated.
The route accepts both:

- **Canonical keys:** `radiology/...` (current scheme)
- **Legacy keys:** anything under the `PUBLIC_OBJECT_SEARCH_PATHS` or
  `PRIVATE_OBJECT_DIR` env vars (see below)

The legacy env vars are kept only so a bucket that contains old data
from a prior deployment (where keys were prefixed `/mednexus/...` or
`/objects/...`) is still readable. New writes never use them.

## Env Variables

| Variable                    | Default     | Purpose                                           |
| --------------------------- | ----------- | ------------------------------------------------- |
| `S3_BUCKET`                 | (required)  | Bucket name                                       |
| `S3_ENDPOINT`               | (local)     | S3/MinIO endpoint                                 |
| `S3_REGION`                 | `us-east-1` | For AWS S3; `auto` for R2                        |
| `S3_ACCESS_KEY_ID`          | (required)  |                                                   |
| `S3_SECRET_ACCESS_KEY`      | (required)  |                                                   |
| `S3_FORCE_PATH_STYLE`       | `false`     | `true` for MinIO                                  |
| `PUBLIC_OBJECT_SEARCH_PATHS` | `/mednexus`  | **Legacy read paths only.** Used to find objects under `/<dir>/<entityId>` (rare; for back-compat with old data). Not used for new writes. |
| `PRIVATE_OBJECT_DIR`        | `/mednexus`  | **Legacy read paths only.** Same as above. Not used for new writes. |

`PUBLIC_OBJECT_SEARCH_PATHS` and `PRIVATE_OBJECT_DIR` are
**compatibility knobs** for buckets that contain objects under the
historical `/mednexus/...` layout. They are not part of the
canonical write path. If your bucket has no legacy data, set them
to empty strings and the api-server will reject the read with a
404.

In dev (`scripts/dev.sh`) the api-server is started with
`PUBLIC_OBJECT_SEARCH_PATHS="/mednexus"` and
`PRIVATE_OBJECT_DIR="/objects"`. These are **only used when
reading** old data and have no effect on new uploads. The mismatch
between the two values is intentional: legacy public reads look
under `/mednexus/<id>` and legacy private reads under
`/objects/<id>`. See the comments in `src/lib/objectStorage.ts` for
the precise lookup logic.

## Image Retrieval

### Streaming (authenticated, default)

```
GET /api/storage/objects/<key>
   ↓
api-server validates session cookie
   ↓
reads from S3
   ↓
streams bytes to the client
```

The server checks that the key starts with `radiology/` (see
`ALLOWED_OBJECT_PREFIXES` in `routes/storage.ts`). Other keys return
403.

### Presigned URL (recommended for large images)

```
GET /api/storage/presigned-url/<bucket>/<key>
   ↓
api-server validates session cookie
   ↓
generates 5-minute presigned S3 URL
   ↓
client downloads directly from S3
```

Presigned URLs are signed by the api-server's S3 credentials and
expire automatically.

## File Validation

Files are validated before upload:

- MIME type check (only `image/png`, `image/jpeg`, `image/gif`,
  `image/webp` accepted; SVG/XML/HTML rejected to prevent stored
  XSS via uploaded "images")
- File size cap (20 MB for SSRF imports, 100 MB for direct
  uploads, configurable)
- Filename sanitisation (`sanitizeFilename` in
  `routes/storage.ts:89`)

## Security Considerations

### Never store sensitive data in:

- Object keys (use UUIDs)
- Filenames (sanitise or replace with the UUID)

### Always:

- Verify the session cookie before any object read
- Use short-lived presigned URLs (5-minute TTL default)
- Never expose S3 credentials to the frontend
- Set the bucket policy to deny anonymous access
- Use the SSRF-protected fetch (`safeFetch`) for any `images/import`

## Switching Storage Backends

The api-server speaks the S3 API, so swapping MinIO ↔ R2 ↔ AWS S3
requires only env-var changes:

```env
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com  # for R2
S3_REGION=auto
```

No code changes are required. The new bucket should be empty (or
contain a one-time `mc mirror` copy from the old bucket).

## Backup Considerations

### Database
```bash
pg_dump -h localhost -U postgres mednexus > backup.sql
```

### MinIO Data
```bash
docker exec minio mc mirror local/mednexus /backup
```

## Troubleshooting

### "Bucket not found" error
```bash
docker compose exec minio mc ls local/mednexus
docker compose exec minio mc mb local/mednexus
```

### "Access denied" on upload
1. Verify credentials in `.env`
2. Check bucket policy allows writes
3. Verify the IAM user has `PutObject` permission

### Object is on a `/mednexus/...` legacy path

The bucket has objects from an earlier deployment. They are still
readable via the legacy env vars. To migrate them, run a one-time
script that copies each object to its new key under `radiology/...`
and updates the database row's `object_key`.

## Testing Storage

### Upload test
```bash
curl -X POST http://localhost:3004/api/storage/uploads/request-url \
  -H "Content-Type: application/json" \
  -d '{"name":"test.jpg","size":1024,"contentType":"image/jpeg"}' \
  -b "session=..."
```

### Download test
```bash
curl http://localhost:3004/api/storage/objects/radiology/test-uuid
```

### Health check
```bash
curl http://localhost:3004/api/storage/health
# Expected: {"status": "ok", "storage": "healthy"}
```
