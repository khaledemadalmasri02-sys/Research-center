# Medical Radiology Data Collection

A web application for managing radiology patient data with image storage support.

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
             └──────────┬───────────┘
                        │
                        ▼
             ┌──────────────────────┐
             │       Backend        │
             │   (Express + Node)   │
             │  Auth/API/Server     │
             └───────┬───────┬──────┘
                     │       │
               metadata │ objects
                     │       │
                     ▼       ▼
             ┌──────────┐  ┌─────────────┐
             │ Database │  │    MinIO    │
             │  (Postgres)│  │   (S3)     │
             └──────────┘  └─────────────┘
```

See [docs/architecture/routing.md](docs/architecture/routing.md) for the
production request flow, which paths the Worker serves directly, and
how `/api/*` falls through to the api-server.

## Features

- Patient record management
- Radiology image upload and storage
- Excel import/export functionality
- Authentication system
- AI prediction output tracking

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)

### Option 1: Docker Compose (Recommended)

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Start all services:
   ```bash
   docker compose up -d
   ```

3. Initial setup (one-time):
    ```bash
    # Set up MinIO buckets
    pnpm run dev:s3
    ```

4. Access the application:
    - Frontend: http://localhost:3003
    - API: http://localhost:3004

### Option 2: Local Development (without Docker for API)

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Start PostgreSQL:
   ```bash
   docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine
   ```

3. Start MinIO:
   ```bash
   docker run -d -p 9000:9000 -p 9001:9001 \
     -e MINIO_ROOT_USER=minioadmin \
     -e MINIO_ROOT_PASSWORD=minioadmin \
     -v minio_data:/data \
     minio/minio server /data --console-address ":9001"
   ```

4. Create S3 bucket:
   ```bash
   aws --endpoint-url http://localhost:9000 s3 mb s3://mednexus
   aws --endpoint-url http://localhost:9000 s3 mb s3://mednexus/radiology-public
   aws --endpoint-url http://localhost:9000 s3 mb s3://mednexus/radiology-objects
   ```

5. Set environment variables and start the servers:
   ```bash
   # Copy env file and edit as needed
   cp .env.example .env

   # Run dev servers
   pnpm run dev
   ```

   Or start individually:
   ```bash
   # Local API server (dev mode with in-memory DB)
   PORT=3002 ./node_modules/.bin/tsx artifacts/local-api/src/index.ts

   # Mockup sandbox
   PORT=3003 ./node_modules/.bin/vite dev artifacts/mockup-sandbox --host 0.0.0.0

   # Main frontend
   PORT=3004 ./node_modules/.bin/vite dev artifacts/research-data --host 0.0.0.0
   ```

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Start PostgreSQL:
   ```bash
   docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine
   ```

3. Start MinIO:
   ```bash
   docker run -d -p 9000:9000 -p 9001:9001 \
     -e MINIO_ROOT_USER=minioadmin \
     -e MINIO_ROOT_PASSWORD=minioadmin \
     -v minio_data:/data \
     minio/minio server /data --console-address ":9001"
   ```

4. Create S3 bucket:
   ```bash
   aws --endpoint-url http://localhost:9000 s3 mb s3://mednexus
   aws --endpoint-url http://localhost:9000 s3 mb s3://mednexus/radiology-public
   aws --endpoint-url http://localhost:9000 s3 mb s3://mednexus/radiology-objects
   ```

5. Set environment variables and start the server:
   ```bash
   cd artifacts/api-server
   pnpm run dev
   ```

6. Start the frontend:
   ```bash
   cd artifacts/research-data
   pnpm run dev
   ```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `PORT` | API server port | 3004 |
| `SESSION_SECRET` | Session secret key | - |
| `APP_USERNAME` | Admin username | admin |
| `APP_PASSWORD_HASH` | Bcrypt password hash | - |
| `S3_ENDPOINT` | MinIO/S3 endpoint | http://localhost:9000 |
| `S3_REGION` | S3 region | us-east-1 |
| `S3_ACCESS_KEY_ID` | S3 access key | minioadmin |
| `S3_SECRET_ACCESS_KEY` | S3 secret key | minioadmin |
| `S3_BUCKET` | S3 bucket name | mednexus |
| `S3_FORCE_PATH_STYLE` | Use path-style URLs | true |
| `S3_SIGNED_URL_EXPIRES_SECONDS` | Presigned URL TTL | 300 |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Public object paths | radiology-public |
| `PRIVATE_OBJECT_DIR` | Private object directory | radiology-objects |

## Storage Configuration

The application uses MinIO for object storage with S3-compatible API:

- **Public uploads**: `s3://mednexus/radiology-public/`
- **Private uploads**: `s3://mednexus/radiology-objects/uploads/`
- **Object paths stored in DB**: `/objects/...`

## API Endpoints

- `GET /api/healthz` - Basic health check
- `GET /api/storage/health` - Storage health check (bucket verification)
- `POST /api/storage/uploads/request-url` - Get presigned upload URL
- `GET /api/storage/public-objects/*` - Serve public objects
- `GET /api/storage/objects/*` - Serve private objects
- `GET /api/storage/presigned-url/:bucket/:key` - Get presigned download URL

## Switching to Cloudflare R2

To switch from MinIO to Cloudflare R2:

1. Update environment variables:
   ```env
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_ACCESS_KEY_ID=<access-key-id>
   S3_SECRET_ACCESS_KEY=<secret-access-key>
   S3_BUCKET=<bucket-name>
   ```

2. No code changes required.

## Docker Commands

```bash
# Start all services (Postgres + MinIO + API + Frontend)
pnpm run dev:s3

# Or use docker compose directly
docker compose up -d

# View logs
docker compose logs -f
pnpm run docker-logs

# Stop services
pnpm run docker-down
docker compose down

# Recreate containers with fresh volumes
docker compose down -v
docker compose up -d
```

## Development Commands

```bash
# Type check
pnpm run typecheck

# Build all
pnpm run build

# Start local development servers (requires Docker for S3+Postgres)
pnpm run dev

# Start MinIO + buckets for development
pnpm run dev:s3

# Stop all Docker services
pnpm run stop
```

## License

MIT