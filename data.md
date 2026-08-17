# Implement Local S3-Compatible Image Storage

## Objective

Modify the existing application so that uploaded images and other large binary files are stored in a **local S3-compatible object storage service**, preferably **MinIO**, instead of being stored directly inside the database as Base64/BLOB/TEXT data.

The application should store only **metadata and object references** in the database.

The implementation must preserve all existing application functionality and should be designed so that the storage backend can later be switched from local MinIO to Cloudflare R2 with minimal code changes.

---

# 1. IMPORTANT: Analyze the Existing Project First

Before changing anything:

1. Inspect the entire project structure.
2. Identify:
   - Frontend framework
   - Backend framework
   - Database technology
   - ORM/database layer
   - Existing image/file upload implementation
   - Existing radiology/image fields
   - Authentication/authorization
   - API routes
   - Environment-variable configuration
   - Deployment configuration
   - Docker/Compose configuration
3. Search the entire project for:
   - `radiologyImageFilePathOrLink`
   - image upload code
   - Base64 conversion
   - `data:image`
   - `blob`
   - `Buffer`
   - file upload endpoints
   - image storage logic
   - database columns containing image data
   - Excel import/export involving image URLs
4. Determine whether images are currently stored:
   - as Base64
   - as BLOB
   - as TEXT
   - as filesystem paths
   - as URLs
   - or through another mechanism.

Do NOT blindly rewrite existing functionality.

First understand the current architecture and then implement the smallest safe architectural change.

---

# 2. Target Architecture

Implement this architecture:

```text
                    ┌──────────────────────┐
                    │      Frontend        │
                    │                      │
                    │ Image upload/view    │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │       Backend        │
                    │                      │
                    │ Auth/API             │
                    │ Image service        │
                    └───────┬───────┬──────┘
                            │       │
                  metadata  │       │ objects
                            │       │
                            ▼       ▼
                    ┌──────────┐  ┌─────────────┐
                    │ Database │  │   MinIO     │
                    │          │  │             │
                    │ Patient  │  │ Images      │
                    │ Study    │  │ DICOM       │
                    │ Report   │  │ Attachments  │
                    │ Metadata │  │ Files        │
                    └──────────┘  └─────────────┘
```

The database must NOT contain the actual image binary/Base64 data.

---

# 3. Use MinIO as the Local S3-Compatible Storage

Use MinIO as the local object-storage server.

MinIO should expose an S3-compatible API.

The application should communicate with MinIO through the standard S3 API rather than using MinIO-specific application logic wherever possible.

Prefer an S3-compatible SDK such as:

```text
@aws-sdk/client-s3
```

if the project's technology stack supports it.

If the project already uses another suitable S3-compatible library, evaluate whether it should be retained instead of introducing unnecessary dependencies.

---

# 4. Storage Configuration

Create environment variables for S3-compatible storage.

Use names similar to:

```env
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=mednexus
S3_FORCE_PATH_STYLE=true
```

Do NOT hard-code credentials.

Use `.env.example` to document the required configuration.

If the project already has a configuration system, integrate with it rather than creating a second configuration mechanism.

---

# 5. Docker Compose

If the project already uses Docker Compose, add MinIO to the existing Compose configuration.

If Docker Compose does not exist, create an appropriate Compose configuration only if it fits the existing architecture.

Example architecture:

```yaml
services:
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
```

Use environment variables for credentials.

Do not expose the MinIO administrative console publicly through Cloudflare Tunnel unless there is a specific security requirement.

---

# 6. Bucket

Create a bucket for application files.

Example:

```text
mednexus
```

The bucket name should be configurable through:

```env
S3_BUCKET=mednexus
```

The application should automatically verify that the bucket exists during startup or through an initialization mechanism.

Do not recreate or delete the bucket every time the application starts.

---

# 7. Object Naming

Implement a predictable object-key structure.

For example:

```text
radiology/{studyId}/{uuid}.{extension}
```

or:

```text
radiology/{patientId}/{studyId}/{uuid}.{extension}
```

Prefer UUIDs or other collision-resistant identifiers.

Do NOT use the original filename as the sole object key.

The original filename may still be stored as metadata.

Example:

```text
radiology/
└── study-123/
    ├── 7b8e2a1c-....jpg
    ├── 8e12d93a-....png
    └── 9c72fabc-....jpg
```

---

# 8. Database Changes

Inspect the existing database schema before making changes.

The database should store metadata such as:

```text
id
patient_id
study_id
object_key
original_filename
mime_type
file_size
etag
created_at
updated_at
```

If the existing column is:

```text
radiologyImageFilePathOrLink
```

determine whether it should:

1. remain for backwards compatibility,
2. be migrated to an object key,
3. be replaced by a normalized image/file table.

Prefer a dedicated image/file table if multiple images can belong to one radiology study.

Example conceptual schema:

```text
radiology_images

id
study_id
object_key
original_filename
mime_type
file_size
etag
created_at
```

Do not store:

```text
base64_image
```

or the actual binary image in the database.

---

# 9. Image Upload API

Implement or refactor the image upload endpoint.

Expected flow:

```text
Frontend
   │
   │ multipart/form-data
   ▼
Backend
   │
   ├── authenticate user
   ├── authorize access
   ├── validate file
   ├── generate object key
   ├── upload to S3-compatible storage
   └── store metadata in database
```

The database record should only be created after successful object upload.

If database insertion fails after the object is uploaded, implement cleanup where appropriate so that orphaned objects are not unnecessarily left behind.

---

# 10. File Validation

Do not trust the filename extension.

Validate:

- MIME type
- file size
- extension where appropriate
- actual file type where practical

Use configurable limits.

For example:

```env
MAX_IMAGE_SIZE_MB=20
```

Do not impose an arbitrary 20 MB limit if the existing application legitimately requires larger radiology files. Determine suitable limits from the existing application requirements.

---

# 11. Image Retrieval

Do NOT make the entire S3 bucket publicly accessible.

Prefer one of these approaches.

## Option A — Backend streaming

```text
Frontend
   ↓
GET /api/radiology-images/:id
   ↓
Backend authentication
   ↓
S3/MinIO
   ↓
Image
```

## Option B — Presigned URLs

```text
Frontend
   ↓
GET /api/radiology-images/:id/url
   ↓
Backend authorization
   ↓
Presigned S3 URL
   ↓
Frontend downloads image
```

Prefer presigned URLs when appropriate because large files do not need to pass through the application server.

However, do not expose unrestricted permanent URLs.

Presigned URLs should have a configurable short expiration period.

Example:

```env
S3_SIGNED_URL_EXPIRES_SECONDS=300
```

---

# 12. Security

This application may contain medical/radiology information.

Implement secure defaults.

Requirements:

- Never commit S3 credentials.
- Never expose the MinIO root credentials to the frontend.
- Never put S3 secret keys in browser code.
- Do not make the entire bucket public.
- Require authentication for image access.
- Verify that the authenticated user is authorized to access the associated study/patient data.
- Validate uploaded files.
- Prevent path traversal.
- Do not use arbitrary user-provided object keys.
- Do not expose MinIO administrative credentials.
- Do not expose the MinIO console publicly by default.

---

# 13. Excel Import

The application currently supports Excel import.

Preserve this functionality.

If Excel contains:

```text
radiologyImageFilePathOrLink
```

support URLs such as:

```text
https://example.com/image.jpg
```

and determine how they should be handled.

Do NOT automatically download arbitrary remote URLs without considering SSRF/security risks.

If the existing application expects external URLs, preserve compatibility.

If an imported Excel file references an existing local/S3 object, support the appropriate object-key/reference format.

Document the supported Excel formats.

---

# 14. Backwards Compatibility

Existing records may contain:

- Base64 images
- old local paths
- external URLs
- old image references

Do NOT break existing data.

Implement a migration strategy.

Possible migration approach:

```text
Old database image
        ↓
Migration script
        ↓
Upload to MinIO
        ↓
Create object metadata
        ↓
Update database reference
```

Do not automatically execute a destructive migration.

Create a separate migration/import script if required.

---

# 15. Migration Tool

If the current project contains Base64 images or database-stored image data, create a migration utility.

The migration should:

1. Find existing stored images.
2. Decode/read the image.
3. Generate a safe object key.
4. Upload it to MinIO.
5. Verify successful upload.
6. Create/update the metadata record.
7. Optionally retain the old value until migration has been verified.

The migration must be:

- resumable
- idempotent where possible
- logged
- safe to run multiple times
- able to report failures

Do NOT delete old image data automatically.

---

# 16. Storage Abstraction

Create a storage service abstraction.

For example:

```text
StorageService
```

with operations conceptually similar to:

```text
upload()
download()
delete()
exists()
getPresignedUrl()
```

The application should not scatter S3-specific code throughout controllers/components.

Instead:

```text
API
 ↓
StorageService
 ↓
S3-compatible provider
 ↓
MinIO
```

This is important because the same application should later be able to use:

```text
Local MinIO
        ↓
Cloudflare R2
```

without rewriting the application.

---

# 17. Cloudflare R2 Compatibility

The implementation must remain compatible with Cloudflare R2.

Avoid relying on MinIO-only APIs.

Use the standard S3 API.

The goal should be that changing:

```env
S3_ENDPOINT
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_BUCKET
S3_REGION
```

is sufficient to switch from local MinIO to R2, assuming the rest of the application supports the corresponding R2 configuration.

Do not write separate storage implementations unless technically necessary.

---

# 18. Cloudflare Tunnel

The application may later be exposed through Cloudflare Tunnel.

Do NOT assume that MinIO itself must be publicly exposed.

Preferred architecture:

```text
Internet
   │
   ▼
Cloudflare
   │
   ▼
Cloudflare Tunnel
   │
   ▼
Local server
   │
   ├── Web application
   ├── API
   ├── Database
   └── MinIO
```

If the application uses presigned URLs, make sure the generated URLs are actually usable from the intended client/network architecture.

Do not expose MinIO's admin console through the tunnel by default.

---

# 19. Local Development

Provide clear local-development instructions.

Expected workflow:

```bash
docker compose up -d
```

Then verify:

```text
Application
MinIO API
MinIO bucket
Database
```

Document the relevant ports.

Do not assume that ports are available without checking the existing project.

---

# 20. Health Checks

Add appropriate health checks where compatible with the existing architecture.

The application should be able to detect when:

```text
Database unavailable
S3/MinIO unavailable
Bucket unavailable
```

Do not crash unnecessarily because a storage service is temporarily unavailable if the application can safely continue operating.

---

# 21. Error Handling

Implement useful errors for:

- upload failure
- invalid file
- file too large
- unsupported MIME type
- missing object
- S3 connection failure
- unauthorized access
- database failure
- orphaned object cleanup

Do not expose internal S3 credentials or internal infrastructure details in API responses.

---

# 22. Logging

Log useful operational information such as:

```text
upload started
upload completed
object key
file size
upload duration
database record created
upload failed
```

Do NOT log:

- S3 secret keys
- authentication tokens
- sensitive patient information unnecessarily
- Base64 image contents

---

# 23. Testing

After implementation, test at minimum.

## Upload

```text
Upload JPEG
Upload PNG
Upload invalid file
Upload oversized file
```

## Retrieval

```text
Authorized user → image accessible
Unauthorized user → denied
Missing object → correct error
Expired presigned URL → denied
```

## Database

Verify that the database contains:

```text
object_key
metadata
```

and NOT:

```text
large Base64 image
```

## Storage

Verify that the actual file exists in MinIO.

## Delete

When an image is deleted:

```text
database record
+
MinIO object
```

should be handled consistently.

## Restart

Restart the application and MinIO.

Verify that previously uploaded files remain available.

---

# 24. Do Not Over-Engineer

Do not introduce unnecessary infrastructure.

The desired architecture is:

```text
Frontend
   ↓
Backend
   ├── Database → metadata
   └── MinIO → files/images
```

Do NOT introduce:

- Kubernetes
- Redis
- Kafka
- unnecessary microservices
- a separate image server
- a cloud database

unless the existing project genuinely requires them.

---

# 25. Documentation

Update or create:

```text
README.md
```

and document:

1. Architecture
2. MinIO installation
3. Environment variables
4. Docker Compose
5. Bucket configuration
6. Upload process
7. Image retrieval
8. Presigned URLs
9. Security
10. Excel import behavior
11. Migration from old image storage
12. How to switch from MinIO to Cloudflare R2
13. Backup considerations
14. Troubleshooting

Also create:

```text
STORAGE.md
```

containing the storage architecture and migration details.

---

# 26. Final Architecture

The final implementation should follow this principle:

```text
DATABASE
────────

Patient
Study
Report
Image metadata
Object key
File type
File size
Timestamps


MINIO
─────

Actual images
Actual files
Large binary objects
DICOM files
Radiology attachments
```

Never use the relational database as the primary storage location for large images unless there is a specific documented requirement.

---

# 27. Implementation Process

Follow this exact order.

## Phase 1 — Analyze

Inspect the project and report:

```text
Current database:
Current image storage:
Current upload endpoint:
Current image schema:
Current Excel import:
Current authentication:
Current deployment:
```

## Phase 2 — Design

Describe the minimal changes required.

## Phase 3 — Implement

Implement:

```text
MinIO
S3 configuration
Storage service
Database metadata
Upload
Retrieval
Deletion
Security
Migration
```

## Phase 4 — Test

Run the project's existing tests.

Add tests for the new storage functionality.

## Phase 5 — Verify

Confirm:

```text
✓ Images are stored in MinIO
✓ Database stores only metadata/references
✓ Existing functionality still works
✓ Excel import still works
✓ Authentication is enforced
✓ MinIO credentials are not exposed
✓ Storage can later be switched to Cloudflare R2
✓ Existing data is not destroyed
```

## Phase 6 — Document

Update the project's documentation with complete setup and migration instructions.

---

# Important Rules

1. **Do not delete existing data.**
2. **Do not replace working functionality unnecessarily.**
3. **Analyze the existing project before modifying it.**
4. **Do not store new images as Base64 in the database.**
5. **Do not expose the MinIO bucket publicly by default.**
6. **Do not expose S3 credentials to the frontend.**
7. **Use an S3-compatible abstraction.**
8. **Keep the implementation compatible with Cloudflare R2.**
9. **Use environment variables for all credentials/configuration.**
10. **Preserve backwards compatibility with existing image references whenever possible.**
11. **Create migrations rather than silently destroying old image data.**
12. **Run tests after implementation.**

## Success Criteria

The implementation is successful when a newly uploaded radiology image follows this flow:

```text
User
 │
 ▼
Frontend
 │
 ▼
Backend API
 │
 ├──────────────► MinIO
 │                  │
 │                  └── actual image
 │
 └──────────────► Database
                    │
                    ├── image ID
                    ├── study ID
                    ├── object key
                    ├── MIME type
                    ├── size
                    └── metadata
```

The database must never need to contain the complete Base64 representation of the newly uploaded image.

The storage layer should be designed so that:

```text
Local MinIO
     ↓
Cloudflare R2
```

can be performed primarily by changing configuration rather than rewriting application logic.
