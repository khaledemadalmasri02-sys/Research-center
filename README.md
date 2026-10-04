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
- Radiology image upload (presigned upload, authenticated streamed
  download) and S3-backed storage
- Excel import/export with column mapping
- Authentication: session + 6-digit email OTP + OAuth (Google, Apple),
  with CSRF protection
- AI prediction output tracking
- Cloudflare Worker research portal with D1-backed cohorts and reports
- GDPR erasure orchestration across D1, Postgres and object storage

---

> **Before you trust any feature end-to-end, read the remediation-pass
> section at the top of [`STATUS.md`](STATUS.md).** In particular the D1
> clinical routes are backed by an empty table in production (D1/Postgres
> split-brain), DICOM de-identification is metadata-only, and there is no
> read-access audit. `SECURITY.md` §"Known gaps (security)" lists all
> eleven; `STATUS.md` §"Still open" lists thirteen.

---

## Quick start

### Prerequisites

- **Node.js 22.6+** (`package.json` `engines.node` is `>=22.6`; `.nvmrc`
  pins `22`). Vitest and the Vite 7 toolchain need the 22.x runtime.
- pnpm 9+ (CI uses pnpm 11)
- Docker (for Postgres + MinIO via `docker compose`, or for the
  "local" path below)

### Option 1 — Docker Compose (recommended)

`docker compose up -d` starts **Postgres and MinIO only** — those are the
only two services in `docker-compose.yml`. The api-server and the
frontends are Node processes and must be started separately.

```bash
cp .env.example .env
docker compose up -d          # Postgres + MinIO only
pnpm run dev                  # api-server (:4000) + research-data SPA (:4004)
```

If you prefer one command, `pnpm run dev` runs `scripts/dev.sh`, which
starts the compose services, waits for Postgres + MinIO, creates the MinIO
buckets, and then launches both Node services.

- Frontend: <http://localhost:4004>
- API: <http://localhost:4000>

Postgres (5432) and MinIO (9000) are published to **127.0.0.1 only** — the
containers hold PHI, so they are never reachable from another machine. The
MinIO console (9001) is not published to the host at all; use
`docker compose exec -T minio mc ...`.

### Ports

One scheme is used repo-wide (`scripts/dev.sh`, `package.json` `dev:apps`,
`scripts/research-deploy.sh`):

| Port | Purpose |
| --- | --- |
| `4000` | api-server (`/api/*`) — the Vite dev proxy and the nginx proxy both target it |
| `4003` | mockup-sandbox frontend (`pnpm run dev:apps` only) |
| `4004` | research-data SPA (the production UI) |
| `8080` | nginx reverse proxy in front of the api-server; origin of the Cloudflare tunnel |
| `5432` | Postgres — 127.0.0.1 only |
| `9000` | MinIO S3 API — 127.0.0.1 only |
| `9001` | MinIO console — internal to the compose network, not published |

The **3003/3004** scheme is gone. `PORT=4000` is pinned by `scripts/dev.sh`
(not taken from `.env`) so a stray `PORT=` in an env file cannot change the
dev topology.

### Option 2 — Local development (no Docker for the app)

Useful when you only want to run the Node services locally and keep
Postgres + MinIO in Docker.

```bash
pnpm install

# 1. Postgres — bind to loopback only; this database holds patient data
docker run -d -p 127.0.0.1:5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  postgres:16.15-alpine

# 2. MinIO — loopback only, and NOT the published default credentials
#    (openssl rand -hex 24); this bucket holds PHI
docker run -d -p 127.0.0.1:9000:9000 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -v minio_data:/data \
  minio/minio:RELEASE.2025-04-22T22-12-26Z server /data --console-address ":9001"

# 3. Buckets — `pnpm run dev:s3` does this for you (see below)
aws --endpoint-url http://localhost:9000 s3 mb s3://mednexus

# 4. All services in parallel (api-server + research-data SPA)
pnpm run dev
```

`pnpm run dev:apps` additionally starts mockup-sandbox on 4003.

To run a single service instead — note the **real package names**, which are
not the directory names:

```bash
pnpm --filter @workspace/api-server dev     # api-server   (research/api-server)
pnpm --filter @workspace/research-data dev  # research-data SPA
pnpm --filter research-worker dev           # Cloudflare Worker (wrangler dev)
pnpm --filter @workspace/db typecheck       # shared Drizzle schema package
```

`pnpm --filter api-server dev`, `--filter research-data` and
`--filter research` do not match anything and fail.

---

## Environment variables

Config is split across **three** `.env.example` files. Do not duplicate a
variable between them — that is how they drifted before.

| File | Owns |
| --- | --- |
| [`.env.example`](.env.example) (root) | `docker-compose.yml` interpolation (`POSTGRES_*`, the two MinIO root keys) and the inputs `scripts/research-deploy.sh` requires. **Plus `PUBLIC_OBJECT_SEARCH_PATHS` / `PRIVATE_OBJECT_DIR`, which are the source of truth for the object-store prefixes** (`scripts/dev.sh` sources this file). |
| [`artifacts/api-server/.env.example`](artifacts/api-server/.env.example) | Everything the api-server reads: `DATABASE_URL`, `PORT`, `SESSION_SECRET`, `NODE_ENV`, `APP_*`, `ALLOWED_ORIGINS`, `SECURE_CORS`, `SESSION_COOKIE_*`, `JSON_BODY_LIMIT`, `OTP_LENGTH`, `LOG_LEVEL`, `S3_*`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`, `SMTP_*`, `MAIL_*`, `GOOGLE_*`/`APPLE_*`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CF_ACCOUNT_ID`, `CF_EMAIL_TOKEN`, `APP_PUBLIC_URL`, `TOUR_MEDIA_DIR`, `MAX_IMAGE_SIZE_MB`. |
| [`research/.env.example`](research/.env.example) | Cloudflare Worker **bindings/secrets**: `API_BACKEND_URL`, `APP_USERNAME`, `APP_PASSWORD_HASH`, `SESSION_SECRET`, `S3_*`, `INBOUND_EMAIL_SECRET`, `UNSUBSCRIBE_STATUS_TOKEN`, `GROQ_API_KEY`. Set with `wrangler secret put`. |
| [`artifacts/research-data/.env.example`](artifacts/research-data/.env.example) | The Vite dev server: `PORT` (4004), `HOST`, `BASE_PATH`, `API_PROXY_TARGET`. Not read by Vite automatically — export them or use `scripts/dev.sh`. |

### The api-server variables that matter most

| Variable | Description | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `PORT` | API server port | `4000` (required — the server throws without it) |
| `SESSION_SECRET` | Session secret key (32+ bytes); refuses to boot in production without it | dev fallback |
| `NODE_ENV` | `development` \| `production`; in production the cookie becomes `__Host-rc_sid` and `Secure` | `development` |
| `APP_USERNAME` / `APP_PASSWORD_HASH` | Admin identity; bcrypt hash, cost 12 | `admin` / placeholder |
| `ALLOWED_ORIGINS` | CORS allowlist — **required in production** | localhost dev origins (4003/4004) |
| `SECURE_CORS` | `allow-any` escape hatch for cloud IDEs; do not use in production | unset |
| `SESSION_COOKIE_SAMESITE` | `lax` (default) \| `strict` \| `none` | `lax` |
| `SESSION_COOKIE_DOMAIN` | defaults to `.research-center.fit` in production, host-only otherwise | unset |
| `LOG_LEVEL` | pino level | `info` |
| `JSON_BODY_LIMIT` | JSON body cap | `1mb` |
| `OTP_LENGTH` | OTP digits (4–8) | `6` |
| `MAX_IMAGE_SIZE_MB` | **not read by any source file today** — documentation only | `100` |
| `S3_ENDPOINT` | MinIO/S3 endpoint | `http://localhost:9000` |
| `S3_REGION` | S3 region | `us-east-1` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S3 credentials | none — set explicitly (dev: `minioadmin`) |
| `S3_BUCKET` | S3 bucket name | `mednexus` |
| `S3_FORCE_PATH_STYLE` | Use path-style URLs | `true` |
| `S3_SIGNED_URL_EXPIRES_SECONDS` | Library default TTL (the upload flow passes 900 explicitly) | `300` |
| `PUBLIC_OBJECT_SEARCH_PATHS` | **Legacy** read prefixes (comma-separated) | `/mednexus` |
| `PRIVATE_OBJECT_DIR` | **Legacy** private read prefix; required | `/mednexus` |
| `SMTP_HOST/PORT/SECURE/USER/PASS` | SMTP2GO sending; without it `sendEmail()` no-ops | — |
| `SMTP_FROM` / `MAIL_FROM` / `MAIL_FROM_NAME` / `MAIL_REPLY_TO` | From-address and reply routing | — |
| `CF_ACCOUNT_ID` / `CF_EMAIL_TOKEN` | Cloudflare Email Sending alternative; takes effect when `SMTP_USER` is empty | unset |
| `MAIL_UNSUBSCRIBE_URL` | Footer unsubscribe target | `https://research-center.fit/unsubscribe` |
| `MAIL_UNSUBSCRIBE_LOOKUP_URL` | Worker base URL for the pre-send suppression check; empty = skip | `https://research-center.fit` |
| `MAIL_UNSUBSCRIBE_LOOKUP_TOKEN` | Must match the Worker's `UNSUBSCRIBE_STATUS_TOKEN`; **without it `GET /api/unsubscribe/status` returns 403** | empty |
| `MAIL_UNSUBSCRIBE_TIMEOUT_MS` | Lookup timeout before fail-open | `800` |
| `MAIL_UNSUBSCRIBE_CACHE_TTL_MS` | Suppression-answer cache TTL | `60000` |
| `INBOUND_EMAIL_SECRET` | Shared secret for `POST /api/inbound-email` | empty |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Google OAuth | empty |
| `APPLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Apple OAuth | empty |
| `GROQ_API_KEY` / `OPENROUTER_API_KEY` | `/api/voice`; empty disables the route | unset |
| `APP_PUBLIC_URL` | Referer header on voice requests; default in email links | `http://localhost:4004` |
| `TOUR_MEDIA_DIR` | Directory served by the tour-media route | `./data/tour-media` |

### Read from the environment but **not documented in any `.env.example`**

These are real and load-bearing; there is no in-repo prompt to set them.

| Variable | Consequence of leaving it unset |
| --- | --- |
| `TRUSTED_PROXY_CIDRS` | `X-Forwarded-For` is ignored entirely (`artifacts/api-server/src/lib/security.ts:159`). Fail-closed, but every per-IP rate limit then buckets on the Cloudflare egress IP. See `SECURITY.md`. |
| `ERASURE_SECRET` | `DELETE /api/gdpr/erasure/:patientId` on the api-server returns **503** unless `INBOUND_EMAIL_SECRET` is set instead (`artifacts/api-server/src/routes/gdpr.ts:43`). |
| `TEST_DATABASE_URL` | Falls back to `DATABASE_URL`, so the test suite will **wipe dev data**. |

---

## Storage configuration

The api-server uses MinIO (or any S3-compatible store) for object
storage. See [`STORAGE.md`](STORAGE.md) for the canonical prefix scheme, the
read-path authorisation gates, the retired public route, and the R2
migration guide.

| Prefix | Bucket / path | Use |
| --- | --- | --- |
| `radiology/*` | `s3://mednexus/radiology/*` | **All new writes.** Every upload and import. |
| `backups/*` | `s3://mednexus/backups/*` | `pg_dump` output from `POST /api/admin/backup`. PHI-bearing and unencrypted. **Not readable through `/api/storage/objects/`.** |
| `/mednexus/*`, `/objects/*` | legacy | Read-only back-compat via `PUBLIC_OBJECT_SEARCH_PATHS` / `PRIVATE_OBJECT_DIR`. |

DB rows store the full object key (e.g. `radiology/1700000000-patient_42_<uuid>.png`);
the read path resolves it against the configured bucket.

---

## API endpoints

See [`artifacts/api-server/STATUS.md`](artifacts/api-server/STATUS.md)
for the full list. The most used ones:

- `GET /api/healthz` — liveness (api-server)
- `GET /api/storage/health` — bucket verification (anonymous)
- `POST /api/storage/uploads/request-url` — presigned upload URL
- `GET /api/storage/objects/*` — private objects (**auth + ACL + patient
  ownership**; this is the only image read path)
- `GET /api/storage/public-objects/*` — **retired**, answers `410 Gone`
- `GET /api/auth/login` | `POST /api/auth/login` | `POST /api/auth/signup` |
  `POST /api/auth/otp/verify`
- `POST /api/crash-report` — anonymous frontend crash reports (rate limited
  20/15min per IP; sends `location.pathname`, never the query string)

There is **no `GET /api/storage/presigned-url/:bucket/:key`** route.
Download streams through `/api/storage/objects/*`; only *upload* uses a
presigned URL. See `STORAGE.md`.

Worker-side (`research/`, D1 + KV) endpoints are listed in
[`docs/architecture/routing.md`](docs/architecture/routing.md). Note that
several of them require an edit-capable role rather than just
authentication — `viewer` gets 403 from the bulk/cross-patient PHI readers
because D1's `patients` table has no owner column to scope against.

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
pnpm run typecheck     # tsc across all workspaces + tests
pnpm run build         # typecheck then build all workspaces
pnpm run lint          # eslint
pnpm run format        # prettier --write
pnpm run verify        # format:check + lint + typecheck + test
pnpm run dev           # scripts/dev.sh: compose services + api-server + SPA
pnpm run dev:apps      # api-server :4000 + mockup-sandbox :4003 + SPA :4004
pnpm run dev:s3        # scripts/docker-up.sh: docker compose up -d, then create the MinIO buckets
pnpm run docker-up     # docker compose up -d (Postgres + MinIO only)
pnpm run docker-logs   # tail docker compose logs
pnpm run docker-down   # stop docker compose
pnpm run stop          # alias for docker-down
```

`pnpm run dev:s3` runs `scripts/docker-up.sh`, which is `docker compose up -d`
**followed by** `mc mb` for `mednexus`, `radiology-public` and
`radiology-objects`. So it is "start Docker + create buckets", not
buckets-only. For buckets only, run `bash scripts/dev-s3-buckets.sh`
(`pnpm run wait-for-services` calls it).

### Tests

All four suites are **vitest** except `@workspace/stats`, which uses
`tsx --test` (node:test).

```bash
pnpm --filter @workspace/api-server test    # 227 tests, 22 files
pnpm --filter research-worker test          # 203 tests, 18 files
pnpm --filter @workspace/research-data test # 87 tests, 13 files
pnpm --filter @workspace/stats test         # 35 tests, 5 files (node:test via tsx)
```

How these were counted: by counting top-level `it(` / `test(` declarations
per test file, which is what a reader can reproduce with
`grep -cE "^\s*(it|test)\(" <files>`. **They are not run results** — the
remediation pass explicitly did not run the suites.

The last reported *run* results, from the 2026-10 remediation pass, were:

| Suite | Passing | Failing | Files |
| --- | --- | --- | --- |
| `@workspace/api-server` | 200 | 6 | 21 |
| `@workspace/research-data` | 75 | 9 | 13 |

Those runs predate 21 new api-server tests
(`test/route-auth-policy.test.ts`) and 3 new research-data tests
(`tests/welcome-vitest.test.tsx`) that landed while this documentation pass
was being written, so the declared totals above are higher than
passing + failing. **Re-run the suites before quoting a pass/fail split**,
and expect the pre-existing failures to still be there.

Notes:

- **`@workspace/stats`, not `@mednexus/stats`** — the package was renamed
  to the `@workspace/*` scope. `pnpm --filter @mednexus/stats test` matches
  nothing.
- **`research-data` is vitest, not `node --test`.** It used to be `node
  --test` run against a config that only matched `*-vitest.test.ts{,x}`,
  which silently skipped every plain `.test.ts` file (7 of them, including
  `desktop-mode.test.ts`). The suite is now a single vitest run with
  `include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]`.
- The root `pnpm test` script runs **only** research-data and
  research-worker. Run the api-server and stats suites explicitly.
- The api-server suite uses Testcontainers Postgres + MinIO via
  `globalSetup` (`fileParallelism: false` so the containers are shared).
- The Playwright a11y specs in `artifacts/research-data/tests/a11y-pages/`
  are **excluded** from vitest and run by `.github/workflows/a11y.yml`.

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
