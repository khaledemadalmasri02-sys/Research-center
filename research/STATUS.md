# research Worker — Status

The active Cloudflare Worker for the public site
(research-center.fit). See [`docs/architecture/routing.md`](../../docs/architecture/routing.md)
for the full two-Worker topology (this + the legacy
`artifacts/worker-api/` for the admin root).

## What works

- **D1-backed features** (15 Hono sub-apps): consent, deidentify,
  cohort, dicom, studies, ml, reports, gdpr, ingest, search,
  coding, export, validation, record-versions, record-verify.
- **CSRF double-submit** on same-origin /api/* writes.
- **Worker → api-server reverse proxy** at `/api/*` with Origin
  rewriting so the api-server sees a same-origin request.
- **Static SPA serving** via the `ASSETS` binding (built by
  `artifacts/research-data` deploy step, copied into
  `research/public/`).
- **Inbound email** via Cloudflare Email Routing: PostalMime parses
  the message and POSTs to the api-server's `/api/inbound-email`.

## What doesn't (yet) work

- **Schema migrations are manual**: the D1 schema lives in
  `research/schema.sql`. There is no per-commit migration
  framework. Run `pnpm exec wrangler d1 execute ... --file=./schema.sql`
  manually after schema changes.
- **No tests for D1 routes**: the Worker has 106 vitest tests but
  they're all for non-D1 code (auth helpers, env validation,
  Email Routing parsing, s3 signing). The D1 routes are
  covered only by manual integration testing.
- **No rate limiting on D1 writes**: the api-server has
  per-IP rate limits (P1.3) but the D1 routes don't have an
  equivalent. A malicious user could spam D1 write quota.

## Known issues (documented in tests)

- The `Awaited` typing for `customFetch` in the orval-generated
  client inlines differently in different runs (path-resolution
  nondeterminism). The codegen drift check (P1.16) strips these
  before hashing.

## Tests

- 106 tests in 17 files, all passing.
- Run with `pnpm -C research test` (or `cd research && npm test`).
- CI: `test-research` job in `.github/workflows/ci.yml`.

## Build / deploy

- `pnpm -C research typecheck` (clean).
- `pnpm -C research exec wrangler deploy --env production` for
  prod, `--env preview` for staging.
- `pnpm -C research exec wrangler d1 execute mednexus-research --env production --remote --file=./schema.sql`
  for schema migrations.
- `scripts/research-deploy.sh` does a full prod deploy
  (api-server + tunnel + Worker + D1 schema).

## Where to start

- New to the Worker? Start with [`src/index.ts`](src/index.ts) for
  the middleware order and route mounts.
- Adding a D1 feature? Add a new file in `src/routes/<feature>.ts`
  (Hono sub-app), wire it in `src/index.ts:95-110`, and add the
  DDL to `schema.sql`.
- Changing the api-server proxy? See
  [`src/index.ts:proxyToBackend`](src/index.ts) — it rewrites
  Origin to the api-server's own base URL.
