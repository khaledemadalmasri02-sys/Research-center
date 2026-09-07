# MedResearch Data Collection & Research Platform

A web application for managing radiology patient data with image storage
support, OCR-driven report import, and a research portal on Cloudflare
Workers + D1.

> **New here?** Start with [`STATUS.md`](STATUS.md) for "what works / what
> doesn't / where to start". See [`CHANGELOG.md`](CHANGELOG.md) for
> recent shipped changes and [`SECURITY.md`](SECURITY.md) for the
> security policy and data-handling guidelines.

---

## Architecture

```
              ┌──────────────────────┐
              │      Frontend        │
              │  (React + Vite)      │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  Cloudflare Worker   │  ← D1 (consent, cohort,
              │  (research/)         │    dicom, ML, reports, …)
              │                      │  ← proxies /api/* →
              │       Backend        │
              │   (Express + Node)   │
              │  Auth/API/Server     │
              └───────┬───────┬──────┘
                      │       │
                metadata │ objects
                      ▼       ▼
              ┌──────────┐  ┌─────────────┐
              │ Database │  │    MinIO    │
              │  (Postgres)│  │   (S3)     │
              └──────────┘  └─────────────┘
```

See [`docs/architecture/routing.md`](docs/architecture/routing.md) for
the production request flow, which paths the Worker serves directly, and
how `/api/*` falls through to the api-server.

---

## Features

- Patient record management
- Radiology image upload, presigned download, and S3-backed storage
- Excel import/export with column mapping
- Authentication (session + 6-digit OTP) and CSRF protection
- AI prediction output tracking
- Cloudflare Worker research portal with D1-backed cohorts and reports

---

## Quick start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for Postgres + MinIO via `docker compose`, or for the
  "local" path below)

### Option 1 — Docker Compose (recommended)

This brings up Postgres, MinIO, the api-server, and the research-data
frontend in one command.

```bash
cp .env.example .env
docker compose up -d
pnpm run dev:s3   # one-time: create the MinIO buckets
```

- Frontend: <http://localhost:3003>
- API: <http://localhost:3004>

### Option 2 — Local development (no Docker for the app)

Useful when you only want to run the Node services locally and keep
Postgres + MinIO in Docker.

```bash
pnpm install

# 1. Postgres
docker run -d -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  postgres:16-alpine

# 2. MinIO
docker run -d -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -v minio_data:/data \
  minio/minio server /data --console-address ":9001"

# 3. Buckets (matches PUBLIC_OBJECT_SEARCH_PATHS / PRIVATE_OBJECT_DIR)
aws --endpoint-url http://localhost:9000 s3 mb s3://mednexus
aws --endpoint-url http://localhost:9000 s3 mb s3://mednexus/radiology-public
aws --endpoint-url http://localhost:9000 s3 mb s3://mednexus/radiology-objects

# 4. All services in parallel (api-server + both frontends)
pnpm run dev
```

To run a single service instead:

```bash
# api-server
pnpm --filter api-server dev

# research-data frontend
pnpm --filter research-data dev

# Worker (research portal)
pnpm --filter research dev
```

---

## Environment variables

The api-server reads its config from environment variables. See
[`artifacts/api-server/.env.example`](artifacts/api-server/.env.example)
for the full list. The most common ones:

| Variable | Description | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `PORT` | API server port | `3004` |
| `SESSION_SECRET` | Session secret key (32+ bytes) | — |
| `APP_USERNAME` | Admin username | `admin` |
| `APP_PASSWORD_HASH` | Bcrypt password hash | — |
| `S3_ENDPOINT` | MinIO/S3 endpoint | `http://localhost:9000` |
| `S3_REGION` | S3 region | `us-east-1` |
| `S3_ACCESS_KEY_ID` | S3 access key | `minioadmin` |
| `S3_SECRET_ACCESS_KEY` | S3 secret key | `minioadmin` |
| `S3_BUCKET` | S3 bucket name | `mednexus` |
| `S3_FORCE_PATH_STYLE` | Use path-style URLs | `true` |
| `S3_SIGNED_URL_EXPIRES_SECONDS` | Presigned URL TTL | `300` |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Public object paths (comma-sep) | `radiology-public` |
| `PRIVATE_OBJECT_DIR` | Private object directory | `radiology-objects` |

---

## Storage configuration

The api-server uses MinIO (or any S3-compatible store) for object
storage. See [`STORAGE.md`](STORAGE.md) for the prefix conventions
(`/objects/...`, `/public/...`), signed-URL flow, and the R2 migration
guide.

| Prefix | Bucket / path | Use |
| --- | --- | --- |
| `/public/*` | `s3://mednexus/radiology-public/*` | Static, cacheable assets |
| `/objects/uploads/*` | `s3://mednexus/radiology-objects/uploads/*` | User uploads |
| `/objects/derived/*` | `s3://mednexus/radiology-objects/derived/*` | Generated artefacts |

The DB stores object paths as `/objects/...` or `/public/...`; the
storage layer resolves them to the underlying bucket.

---

## API endpoints

See [`artifacts/api-server/STATUS.md`](artifacts/api-server/STATUS.md)
for the full list. The most used ones:

- `GET /api/healthz` — liveness
- `GET /api/storage/health` — bucket verification
- `POST /api/storage/uploads/request-url` — presigned upload URL
- `GET /api/storage/public-objects/*` — public objects
- `GET /api/storage/objects/*` — private objects (auth required)
- `GET /api/storage/presigned-url/:bucket/:key` — presigned download URL
- `POST /api/auth/login` / `POST /api/auth/signup` / `POST /api/auth/otp/verify`
- `POST /api/crash-report` — anonymous frontend crash reports (no auth)

---

## Switching to Cloudflare R2

```env
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<access-key-id>
S3_SECRET_ACCESS_KEY=<access-key-secret>
S3_BUCKET=<bucket-name>
S3_FORCE_PATH_STYLE=false
```

No code changes required. Make sure the CORS allowlist in
`artifacts/api-server/src/index.ts` covers your frontend origin.

---

## Development commands

```bash
pnpm run typecheck     # tsc --noEmit across all workspaces
pnpm run build         # build all workspaces
pnpm run dev           # api-server + both frontends in parallel
pnpm run dev:s3        # create the MinIO buckets (one-time)
pnpm run docker-logs   # tail docker compose logs
pnpm run docker-down   # stop docker compose
pnpm run stop          # stop all dev processes
```

### Tests

```bash
pnpm --filter api-server test          # 102 vitest tests
pnpm --filter research test            # 106 vitest tests
pnpm --filter research-data test       # 50 vitest tests
pnpm --filter @mednexus/stats test     # 35 reference-value tests
```

---

## Operations & security

- [`CHANGELOG.md`](CHANGELOG.md) — recent shipped changes
- [`STATUS.md`](STATUS.md) — what works / what doesn't / where to start
- [`SECURITY.md`](SECURITY.md) — security policy, reporting procedure,
  data handling guidelines
- [`STORAGE.md`](STORAGE.md) — S3/MinIO/R2 layout and migration
- [`docs/architecture/routing.md`](docs/architecture/routing.md) —
  production request flow

### Health checks

- `GET /api/healthz` (api-server) — liveness
- `GET /api/health` (Worker) — D1 + R2 readiness

### Secrets

Never commit `.env` files. The Brevo SMTP key used during early
development was rotated; the dev defaults in `.env.example` are
intentionally non-production. See [`SECURITY.md`](SECURITY.md) for the
full policy.

---

## License

MIT. See [`LICENSE`](LICENSE).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow,
security guidelines, and contribution process.
