# api-server — Status

A short snapshot of what works, what doesn't, and what's planned
in `artifacts/api-server/`. For a roadmap see the top-level
[`IMPROVEMENT_PLAN.md`](../../IMPROVEMENT_PLAN.md) and for the
release history see [`../../CHANGELOG.md`](../../CHANGELOG.md).

## What works

- **Auth**: login (password or 2FA via email OTP), signup request +
  admin approval, session + cookie, lockout after 5 failed
  attempts, IP rate limit.
- **Patient records**: CRUD, custom field definitions, image
  attachments via MinIO, advanced search.
- **Analysis**: CSV / XLSX / SAV import, descriptive + ttest +
  ANOVA + chi-square + correlation + regression + normality +
  nonparametric + logistic + reliability + PCA, chart + export
  endpoints, run persistence.
- **Storage**: presigned PUT/GET via `/api/storage/uploads/request-url`,
  SSRF-protected import from URL, public/private prefixes
  (canonical: `radiology/...`; legacy env var for back-compat).
- **Backup**: admin-only DB backup endpoint.
- **Inbound email**: Cloudflare Email Routing target.
- **Observability**: pino + pino-http, `/api/crash-report`
  receiver for frontend crashes.

## What doesn't (yet) work

- **OAuth / SSO**: the current auth model is username + password
  (or 2FA). No Google / Microsoft / SAML / OIDC integration.
- **WebSocket real-time sync**: multi-user editing of the same
  patient record is last-writer-wins, not operational
  transform or CRDT.
- **Multi-tenant**: every record is shared across all admin
  users. The current model assumes one organisation per
  deployment.
- **Audit log retention**: writes are fired-and-forget; long-term
  retention / export to S3 is not implemented.

## Known issues (documented in tests)

- **`Pt` (patient) vs `PT` (prothrombin time)**: the medical
  text corrector's regex is case-insensitive, so "Pt" is
  miscorrected to "prothrombin time". Tracked in
  `tests/medical-correction.test.ts` as a known bug. Fix:
  case-sensitive matching for "Pt" specifically.

## Tests

- 102 tests in 10 files, all passing.
- Run with `pnpm -F @workspace/api-server test`.
- Requires Docker for the Postgres + MinIO testcontainers.
- CI: `test-api-server` job in `.github/workflows/ci.yml`.

## Build / deploy

- `pnpm -F @workspace/api-server typecheck` (clean).
- `pnpm -F @workspace/api-server build` → `dist/index.mjs`.
- `pnpm -F @workspace/api-server start` runs the built bundle.
- `.env.example` documents every required env var. The api-server
  refuses to start in production if `SESSION_SECRET` is unset.

## Where to start

- New to the codebase? Read [`src/app.ts`](src/app.ts) for the
  middleware order, then [`src/routes/index.ts`](src/routes/index.ts)
  for the route mounts.
- Adding a route? Mount it in `src/routes/index.ts` — note the
  `requireAuth, subRouter` pattern for authenticated routes.
- Adding a model? Edit the schema in
  [`../../lib/db/src/schema/`](../../lib/db/src/schema/) and run
  `pnpm -F @workspace/db generate` to update the Drizzle
  migration.
