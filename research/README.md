# Research Worker — research-center.fit

Full-stack Cloudflare Worker: a React SPA (Static Assets) + Hono API, backed by
**D1** (SQLite), **KV** (sessions), and **external S3/MinIO** (object storage).

Live at **https://research-center.fit/** (custom domain + `research-center.fit/*` route).

## Architecture
- **Frontend**: Static Assets served by Cloudflare (`research/public`). Same-origin `/api/*`.
- **API**: Hono routes mounted under `/api/*` (run worker-first).
- **DB**: D1 `mednexus-research`.
- **Sessions**: KV `SESSIONS`.
- **Objects**: external S3/MinIO (configured via secrets).

With `assets.run_worker_first = ["/api/*"]`, only `/api/*` traffic hits the Worker;
all other requests (HTML/JS/CSS, images, SPA client-side routes) are served by the
Static Assets layer, including the single-page-application fallback to `index.html`.

## API endpoints
- `GET  /api/health` — health check
- `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`
- `GET/POST /api/patients` · `GET/POST/PATCH/DELETE /api/patients/:id`
- `GET/POST /api/patients/batch` · `POST /api/patients/batch-import-images`
- `GET /api/patients/stats` · `GET /api/patients/collection-stats`
- `GET /api/db/tables` · `GET /api/db/:table` (Database viewer)
- `POST /api/storage/uploads/request-url` · `POST /api/storage/upload-file`
- `GET  /api/storage/objects/*` (auth) · `GET /api/storage/public-objects/*`
- `POST /api/voice/transcribe` (requires `GROQ_API_KEY`)

## One-time production setup
```bash
cd research
pnpm install

# 1. Database schema (D1, production)
pnpm run d1:migrate
#    or: bash ../scripts/db-migrate.sh

# 2. Secrets (S3/MinIO + session). Prompts for each value:
pnpm run secrets
#    or run individually:
#    wrangler secret put --env production S3_ENDPOINT
#    wrangler secret put --env production S3_ACCESS_KEY_ID
#    wrangler secret put --env production S3_SECRET_ACCESS_KEY
#    wrangler secret put --env production SESSION_SECRET
#    wrangler secret put --env production GROQ_API_KEY   # optional (voice)
```

## Deploy
From the repo root:
```bash
pnpm run deploy          # build frontend -> sync to research/public -> wrangler deploy
```
Or step by step:
```bash
pnpm run build:frontend  # builds artifacts/research-data into research/public
pnpm run deploy:worker   # wrangler deploy --env production
```

## Local development
```bash
# Start MinIO + Postgres (Docker), then:
cd research && pnpm run dev   # wrangler dev (uses top-level wrangler.toml config)
```

## Notes
- Auth creds come from `APP_USERNAME` / `APP_PASSWORD_HASH` (non-secret vars in
  `wrangler.toml`). Change the hash with `bcryptjs` if needed.
- `S3_ENDPOINT` set ⇒ path-style S3 (MinIO / Cloudflare R2 S3 API). Leave it unset
  to use virtual-hosted AWS S3. An `R2_BUCKET` binding is also supported if you ever
  switch to native R2.
