# Storage Architecture

This document describes how the api-server stores and retrieves
radiology images. The conventions here are the **canonical scheme**;
any code that generates a different prefix is a bug.

Security-relevant controls in this file are cross-referenced from
[`SECURITY.md`](SECURITY.md).

## TL;DR

- **Single canonical S3 prefix:** `radiology/`
- **Bucket:** whatever `S3_BUCKET` is set to (default `mednexus`)
- **Object key format:** `radiology/<timestamp>-<uuid>.<ext>` for direct
  uploads and imports, `radiology/<timestamp>-patient_<id>_<uuid>.<ext>`
  for patient-scoped uploads.
- **Read path:** `GET /api/storage/objects/<full-key>` — **authentication
  plus an ACL check plus a patient-ownership check**.
- **No public object route.** `GET /api/storage/public-objects/*` was
  retired in 2026-10 and now answers **410 Gone**. See "Retired routes".

## Current Architecture

```text
Frontend
   ↓
Worker (research/)  ── /api/* ──►  api-server (Express)
                                          ├── Database → metadata
                                          └── MinIO/S3 → actual image files
                                               └── <bucket>/radiology/<object-id>
```

The api-server **owns** the key namespace under `radiology/`. Browsers
never see the bucket directly; every read goes through
`/api/storage/objects/<key>` (authenticated, ACL-checked) or a short-lived
presigned URL minted by the api-server.

## Object Naming Convention

### Uploads

| Source           | Format                                       | Used by                                |
| ---------------- | -------------------------------------------- | -------------------------------------- |
| `request-url`    | `radiology/<timestamp>-<patient_><safe-name>` | `routes/storage.ts:requestUploadUrl`   |
| `upload-file`    | `radiology/<timestamp>-<base>_<uuid>.<ext>`  | `routes/storage.ts:uploadFile`         |
| `images/import`  | `radiology/<timestamp>-<base>_<uuid>.<ext>`  | `routes/storage.ts:importImage`        |
| `images/by-patient` | `radiology/<timestamp>-patient_<id>_<uuid>.<ext>` | `routes/storage.ts:importByPatient` |
| `images/batch`   | `radiology/patient_<id>_<uuid>...`           | `routes/storage.ts:batchImportImages`   |

**Key generation.** The import and upload-file paths use
`crypto.randomUUID()` from `node:crypto`
(`routes/storage.ts:582`, `:658`, and the equivalent in `uploadFile`).
`Math.random().toString(36)` was used before and is gone: V8's
`Math.random` is xorshift128+ whose internal state is recoverable from a
handful of consecutive outputs, which made every previously generated key
*predictable*, not merely unguessable.

`POST /api/storage/uploads/request-url` builds its key from
`Date.now()` + the sanitised client filename and does **not** include a
UUID; its randomness requirement is met by the timestamp plus the
caller-supplied `patientId` prefix (see below), not by a CSPRNG. Treat
request-url keys as lower-confidence than the import paths.

`<object-id>` server-side keys are never derived from the raw client
filename except through `sanitizeFilename()` (`routes/storage.ts:283`),
which replaces every character outside `[a-zA-Z0-9.\-_]` with `_`.

### Reads

`GET /api/storage/objects/<key>` — authenticated, then authorised. The
route first checks the key starts with `radiology/`
(`ALLOWED_OBJECT_PREFIXES`, `routes/storage.ts:49`; other keys → 403),
then runs `denyObjectRead()` (`:222`) **before** reading a byte from S3.

Legacy `/mednexus/...` and `/objects/...` layouts are still resolvable for
*reads* through `PUBLIC_OBJECT_SEARCH_PATHS` / `PRIVATE_OBJECT_DIR`. New
writes never use them.

## Read-path authorisation

Three gates, in order. A denied request never streams the body.

1. **Session.** `router.use("/storage/objects", requireAuth)`
   (`routes/storage.ts:57`). This line did not exist before the
   remediation pass — the entire storage router was open, exposing private
   radiology images and allowing unauthenticated uploads and SSRF.

2. **Object ACL.** `canAccessObject()`
   (`artifacts/api-server/src/lib/objectAcl.ts:150`) reads the
   `aclPolicy` S3 object metadata and grants READ only on an explicit
   `owner` match or `visibility: "public"`. It **fails closed**: no policy
   metadata → deny; an `aclRules` entry with an unresolvable group type →
   that rule grants nothing. `ObjectAccessGroupType` is an intentionally
   empty enum (`:16`) because no group resolver exists yet, so today the
   effective policy is "owner match or explicit public".

3. **Patient ownership.** `denyObjectRead()` extracts the patient id
   encoded in the key (`patientIdFromObjectKey()`, `:178`) and requires
   that the caller's session owns a `patients` row with that id
   (`callerOwnsPatientId()`, `:188`). Admin sessions bypass (`:246`).
   A denial is 403.

The per-patient image routes (`/storage/images/by-patient/:patientId`,
`/storage/images/by-patient`, `/storage/images/search`,
`/storage/upload-file`, `/storage/uploads/request-url`) apply the same
`denyPatientImages()` predicate, which returns **404** (not 403) for a
patient the caller does not own, so the routes are not an existence
oracle.

### Presigned URLs

`POST /api/storage/uploads/request-url` takes an **optional**
`patientId`. When present the caller must own that patient and the id is
baked into the key as `patient_<id>_`, which makes the object attributable
on the read path (`routes/storage.ts:392-411`). `patientId` is additive and
not in the OpenAPI `RequestUploadUrlBody` schema.

Uploads go through `getPresignedUploadUrl(bucket, key, contentType, 900)` —
a **15-minute** upload URL. Download is streamed through the API server
rather than redirected to a presigned URL, because in production the
presigned URL points at an internal MinIO host the browser cannot reach
(`routes/storage.ts:299-306`). `S3_SIGNED_URL_EXPIRES_SECONDS` (default 300)
is the object-storage library default and is not what the upload flow uses.

> **Residual gap (documented, not fixed).** A key that names **no patient**
> and has **no ACL policy** is still readable by any authenticated user,
> because `denyObjectRead()` returns "allow" for an unattributable key
> (`routes/storage.ts:245` — `if (!patientId) return null`). That is
> exactly the key shape `POST /api/storage/uploads/request-url` writes when
> `patientId` is omitted. Until `patientId` is required (or the key gains an
> ACL policy), **always pass `patientId`.**

## Retired routes

### `GET /api/storage/public-objects/*filePath` — retired 2026-10

**This document previously claimed "No public bucket prefix in production"
and that "every read goes through `/api/storage/objects/` (auth)". Both were
false until this pass.** The route had **no authentication middleware at
all**. It resolved `searchPublicObject(filePath)` against the whole
configured search path (`PUBLIC_OBJECT_SEARCH_PATHS`, historically
`/mednexus`) and streamed whatever it found — including `backups/*.sql`,
which are unencrypted full `pg_dump` database dumps written by
`POST /api/admin/backup` into the same bucket. An unauthenticated caller
who could guess or enumerate a key could download a complete database.

It is now `requireAuth` + `requireAdmin` and then answered **410 Gone**
(`routes/storage.ts:465-479`), which is deliberately more informative than
a silent 404: stragglers get an actionable message and the call is logged
(`req.log.warn`). The replacement is `GET /api/storage/objects/<key>`,
which the current SPA already uses
(`artifacts/research-data/src/lib/radiology-images.ts:39`).

Two stale references to the retired route remain in code and should be
cleaned up:

- `lib/api-spec/openapi.yaml:268` still advertises
  `/storage/public-objects/{filePath}`, and the generated client
  (`lib/api-client-react/src/generated/api.ts:766`) still exposes it.
- `routes/storage.ts:873` (`upload-file`) and `:879`-adjacent
  (`images/batch`) return `objectUrl: /api/storage/public-objects/${objectKey}`,
  i.e. URLs that now always 410s.

## Env Variables

| Variable                    | Default     | Purpose                                           |
| --------------------------- | ----------- | ------------------------------------------------- |
| `S3_BUCKET`                 | (required)  | Bucket name                                       |
| `S3_ENDPOINT`               | (local)     | S3/MinIO endpoint                                 |
| `S3_REGION`                 | `us-east-1` | For AWS S3; `auto` for R2                        |
| `S3_ACCESS_KEY_ID`          | (required)  |                                                   |
| `S3_SECRET_ACCESS_KEY`      | (required)  |                                                   |
| `S3_FORCE_PATH_STYLE`       | `false`     | `true` for MinIO                                  |
| `S3_SIGNED_URL_EXPIRES_SECONDS` | `300`  | Library default; the upload flow passes 900 explicitly |
| `PUBLIC_OBJECT_SEARCH_PATHS` | `/mednexus` | **Legacy read paths only.** Not used for new writes. |
| `PRIVATE_OBJECT_DIR`        | `/mednexus` | **Legacy read paths only.** Not used for new writes. Required — the storage layer throws without it. |

### Single source of truth for the prefixes

`PUBLIC_OBJECT_SEARCH_PATHS` and `PRIVATE_OBJECT_DIR` are documented in
**both** `.env.example` (root) and `artifacts/api-server/.env.example`, and
both carry `/mednexus`. **`.env.example` is the source of truth.**

`scripts/dev.sh` previously hardcoded its own pair
(`PUBLIC_OBJECT_SEARCH_PATHS="/mednexus"`, `PRIVATE_OBJECT_DIR="/objects"`),
which contradicted both `.env.example` and `scripts/research-deploy.sh`.
Those overrides are gone; `scripts/dev.sh` now sources `.env` and then
`artifacts/api-server/.env` and takes the prefixes from whatever it finds
(`scripts/dev.sh:12-35`).

Two shell-level fallbacks still exist and still disagree with each other:

- `scripts/research-deploy.sh:280-281` → `/mednexus` and **`/objects`**
- `scripts/tunnel-run.sh:112-113` → `/mednexus` and `/mednexus`

Both are `${VAR:-default}`, so setting the variables (which
`research-deploy.sh` does by exporting them) wins. **If you rely on the
fallbacks rather than the env file, `research-deploy.sh` gives you a
different `PRIVATE_OBJECT_DIR` than `tunnel-run.sh` does.** Set the
variables explicitly.

### Backups must live in a private prefix

`POST /api/admin/backup` writes `pg_dump` output into the same bucket under
`backups/`. `backups/*.sql` is a **complete, unencrypted database
dump** containing every PHI field in the inventory in `SECURITY.md`. It is
now unreachable through the retired public route, and
`ALLOWED_OBJECT_PREFIXES` prevents it from being read through
`/api/storage/objects/*` either (`backups/` does not start with
`radiology/`). Keep it that way: do not add `backups/` to an allowlist, and
do not widen the bucket policy.

## File Validation

Files are validated before upload:

- MIME type check (only `image/png`, `image/jpeg`, `image/gif`,
  `image/webp` accepted; SVG/XML/HTML rejected to prevent stored
  XSS via uploaded "images"). `upload-file` falls back to `image/jpeg`
  when the declared type is not on that list rather than rejecting it.
- File size: `POST /api/storage/upload-file` carries the image as
  **base64 inside the JSON body**, so its ceiling is `JSON_BODY_LIMIT`
  (default 1 MB) and the 413 comes from `express.json`, not from multer.
  `images/import` / `images/by-patient` cap at `MAX_IMPORT_BYTES` = 20 MB.
- Filename sanitisation (`sanitizeFilename`, `routes/storage.ts:283`)
- `images/import` and `images/by-patient` use the SSRF-protected fetch
  (`safeFetch`, 15 s timeout, `image/*` content types only)

`MAX_IMAGE_SIZE_MB` in `artifacts/api-server/.env.example` is **not read by
any source file today** — it documents the intended ceiling only. What is
actually enforced is `JSON_BODY_LIMIT` (1 MB), `MAX_IMPORT_BYTES` (20 MB)
and the per-route S3 limits.

## Security Considerations

### Never store sensitive data in:

- Object keys. Use `crypto.randomUUID()`; the `patient_<id>` segment is
  intentional and is what makes ownership checkable on the read path, but
  it does disclose the medical record number to anyone holding a key.
- Filenames beyond what `sanitizeFilename()` allows.

### Always:

- Verify the session cookie before any object read **and** run the ACL +
  ownership gates.
- Pass `patientId` on every upload so the object is attributable.
- Use short-lived presigned URLs (15 min upload; downloads stream through
  the API server).
- Never expose S3 credentials to the frontend.
- Set the bucket policy to deny anonymous access.
- Use the SSRF-protected fetch (`safeFetch`) for any `images/import`.
- Keep `backups/` out of every object allowlist.

## Switching Storage Backends

The api-server speaks the S3 API, so swapping MinIO ↔ R2 ↔ AWS S3
requires only env-var changes:

```env
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
```

No code changes are required. The new bucket should be empty (or
contain a one-time `mc mirror` copy from the old bucket). Keys do not
carry the bucket name, so a mirror preserves the read-path and ownership
logic unchanged.

## Backup Considerations

### Database
```bash
pg_dump -h localhost -U postgres mednexus > backup.sql
```

This is what `POST /api/admin/backup` automates. The resulting object
lands in the bucket under `backups/` — treat it as PHI-bearing and as
unencrypted.

### MinIO Data
```bash
docker compose exec -T minio mc mirror local/mednexus /backup
```

## Troubleshooting

### "Bucket not found" error
```bash
docker compose exec -T minio mc ls local/mednexus
docker compose exec -T minio mc mb local/mednexus
```
(`POST /api/storage/ensure-bucket` does the same thing and is
session-authenticated.)

### "Access denied" on upload
1. Verify credentials in `artifacts/api-server/.env`
2. Check bucket policy allows writes
3. Verify the IAM user has `PutObject` permission

### 403 on `/api/storage/objects/<key>` that should work
1. Is the key under `radiology/`? Anything else is refused outright.
2. Does the key contain `patient_<id>` where `<id>` is digits only? The
   matcher is `(?:^|[/_-])patient_(\d+)(?:[/_.-]|$)` and ownership is
   checked against `patients.user_id`. Both the bare (`42`) and prefixed
   (`PAT42`) spellings are tried.
3. Does the object carry an `aclPolicy` metadata entry? Without one, gate 1
   denies and gate 2 must succeed on ownership alone.

### Object is on a `/mednexus/...` legacy path

The bucket has objects from an earlier deployment. They are still
readable through the legacy env vars. To migrate them, run a one-time
copy of each object to its new key under `radiology/...` and update the
database row's `object_key`.

## Testing Storage

```bash
# Health (anonymous)
curl http://localhost:4000/api/storage/health
# Expected: {"status":"ok","storage":"healthy"}

# Upload (session cookie required)
curl -X POST http://localhost:4000/api/storage/uploads/request-url \
  -H "Content-Type: application/json" \
  -H "Cookie: <session>" \
  -d '{"name":"test.jpg","size":1024,"contentType":"image/jpeg","patientId":"42"}'

# Download (session cookie required; ACL + ownership enforced)
curl http://localhost:4000/api/storage/objects/radiology/test-uuid \
  -H "Cookie: <session>"

# The retired route — always 410 for an authenticated admin
curl -i http://localhost:4000/api/storage/public-objects/backups/x.sql \
  -H "Cookie: <session>"
```