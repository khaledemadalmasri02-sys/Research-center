# Request routing

This document describes how a request from a browser reaches the right
piece of code in production. If you change a route, an auth check, a
session cookie name, or the proxy path, update this file too.

## Architecture

```
                                    ┌──────────────────────────┐
   browser ──────HTTPS──────►  CF  │  research Worker         │
   (research-center.fit)           │  research/src/index.ts   │  ◄── active
                                    │                          │
                                    │  ┌────────────────────┐  │
                                    │  │  D1-backed routes  │  │  (consent, deidentify,
                                    │  │  (Hono apps)       │  │   cohort, dicom,
                                    │  └────────────────────┘  │   studies, ml,
                                    │           │               │   reports, gdpr,
                                    │           │ match?        │   ingest, search,
                                    │           ▼               │   codings, export,
                                    │       (handled)           │   validation,
                                    │                           │   record-versions,
                                    │                           │   record-verify,
                                    │                           │   unsubscribe)
                                    │  ┌────────────────────┐  │
                                    │  │  /api/* proxy      │◄─┼─ catches everything else
                                    │  │  (catch-all)       │  │
                                    │  └────────┬───────────┘  │
                                    └───────────┼──────────────┘
                                                │ HTTP
                                                ▼
                                    ┌──────────────────────────┐
                                    │  api-server (Express)     │
                                    │  (Postgres + MinIO/S3)    │
                                    │                          │
                                    │  /api/auth, /api/patients │
                                    │  /api/records, /api/...   │
                                    └──────────────────────────┘
```

There is **also** a legacy Worker at `artifacts/worker-api/`. It is
still used by the admin root of the website (see
[artifacts/worker-api/DEPLOY.md](artifacts/worker-api/DEPLOY.md)).
It is **not** the path new code should target — new feature work
goes either into `research/` (D1) or the api-server (Postgres) — but
its routes are still wired up and called by the admin UI, so don't
delete the directory.

## Two Workers, two storage domains

| Deployment              | Status  | Storage | Source                                |
| ----------------------- | ------- | ------- | ------------------------------------- |
| `research/`             | active  | D1      | `research/src/index.ts`              |
| `artifacts/worker-api/` | legacy  | D1      | `artifacts/worker-api/src/index.ts`   |

Both Workers read D1 (Cloudflare SQLite). Neither is authoritative for
the patient record system — that's the api-server's job (Postgres +
MinIO/S3).

The reason both exist is historical: `artifacts/worker-api/` was the
first Worker; `research/` replaced it for the public site and added
the proxy-to-api-server architecture, but the admin root still mounts
parts of the legacy worker. The two Workers share the D1 schema
(`research/schema.sql`).

## Why the proxy rewrites `Origin`

The Worker proxies every `/api/*` request to the api-server with a
rewritten `Origin` header — set to the api-server's own base URL, not
the browser's origin. This means:

- The api-server's CORS allowlist (`ALLOWED_ORIGINS`) only needs to
  list the api-server's own URL plus the dev SPA hosts (3003, 3004,
  127.0.0.1). It does **not** need to enumerate every Worker front-end
  hostname (`research-center.fit`, `www.research-center.fit`).
- The browser still sees the Worker as the origin (it talks only to
  `research-center.fit`). The `Origin` rewrite happens server-to-server
  inside the proxy.

See `research/src/index.ts:proxyToBackend` for the implementation.

## Routes

### Worker D1 routes (active: `research/`)

These are mounted in `research/src/index.ts:95-110`. The path below is
the full URL the browser sees.

| Path                          | Source file                          | Storage |
| ----------------------------- | ------------------------------------ | ------- |
| `/api/consent`                | `research/src/routes/consent.ts`     | D1      |
| `/api/consent/versions`       | same                                 | D1      |
| `/api/deidentify`             | `research/src/routes/deidentify.ts`  | D1      |
| `/api/cohort`                 | `research/src/routes/cohort.ts`      | D1      |
| `/api/validation`             | `research/src/routes/validation.ts`  | D1      |
| `/api/dicom`                  | `research/src/routes/dicom.ts`       | D1      |
| `/api/export`                 | `research/src/routes/export.ts`      | D1      |
| `/api/studies`                | `research/src/routes/studies.ts`     | D1      |
| `/api/ml`                     | `research/src/routes/ml.ts`          | D1      |
| `/api/reports`                | `research/src/routes/reports.ts`     | D1      |
| `/api/gdpr`                   | `research/src/routes/gdpr.ts`        | D1      |
| `/api/ingest`                 | `research/src/routes/ingest.ts`      | D1      |
| `/api/search`                 | `research/src/routes/search.ts`      | D1      |
| `/api/saved-views`            | `research/src/routes/search.ts` (savedViewsApp) | D1 |
| `/api/codings`                | `research/src/routes/coding.ts`      | D1      |
| `/api/record-versions`        | `research/src/routes/recordVersions.ts` | D1   |
| `/api/record-verify`          | `research/src/routes/recordVerify.ts` | D1    |
| `/api/unsubscribe`            | `research/src/routes/unsubscribe.ts` | D1      |

Note: `/api/search` is mounted on both the Worker (D1) and the
api-server (Postgres). The Worker app handles the search query path
(`/api/search` POST), while the api-server handles saved views via
`/api/saved-views` (proxied through the Worker).

### Legacy Worker (`artifacts/worker-api/`)

The legacy worker handles the admin-root part of the website. It
imports `*Handlers` (not `*App`) Hono modules and is mounted
differently from the active worker. See
`artifacts/worker-api/src/index.ts` and
`artifacts/worker-api/DEPLOY.md` for the wiring.

Files used by the legacy worker (kept for that reason — don't delete):

- `research/src/routes/admin.ts` (adminHandlers)
- `research/src/routes/auth.ts` (authHandlers)
- `research/src/routes/extras.ts` (platformHandlers)
- `research/src/routes/feedback.ts` (feedbackHandlers)
- `research/src/routes/patients.ts` (patientsHandlers)
- `research/src/routes/records.ts` (recordsHandlers)
- `research/src/routes/storage.ts` (storageHandlers)
- `research/src/routes/voice.ts` (voiceHandlers)
- `research/src/routes/audit.ts` (auditApp — also used by Worker tests
  in `research/test/audit.test.ts`)

### Proxied routes (api-server, via the active Worker)

The catch-all `app.all("/api/*", proxyToBackend)` in
`research/src/index.ts` forwards any path not matched by a D1 route
to the api-server. The api-server owns:

- `/api/auth/*` — login, signup, OTP, 2FA, me, logout (see
  `artifacts/api-server/src/routes/auth.ts`)
- `/api/patients/*` — patient CRUD + images
- `/api/records/*` — record definitions and records
- `/api/collections/*` — collection definitions
- `/api/analysis/*` — datasets, runs, charts, exports
- `/api/storage/*` — S3 presigned URLs, public/private object streaming
- `/api/audit` — personal activity timeline
- `/api/admin/*` — admin (user mgmt, backups)
- `/api/sessions/*` — session list/revoke
- `/api/tokens/*` — API token CRUD
- `/api/feedback` — feedback widget submissions
- `/api/notifications/*` — user notifications
- `/api/inbound-email` — Cloudflare Email Routing target
- `/api/healthz` — api-server health probe (the Dockerfile's
  `HEALTHCHECK` points here; `/api/health` is the Worker's D1 health
  probe)
- `/api/backup` — admin-only DB backup

See `artifacts/api-server/src/routes/index.ts` for the full mount
list.

### Static assets

Anything that doesn't match `/api/*` falls through to the Worker's
`ASSETS` binding, which serves the built SPA from
`research/public/`. The Worker also injects a JSON-LD `<script>` for
SEO on HTML responses — see `research/src/index.ts:35-81`.

### Inbound email

`research/src/index.ts:handleEmail` is the Cloudflare Email Routing
handler. It parses the message with PostalMime and POSTs it to the
api-server's `/api/inbound-email` endpoint with the
`INBOUND_EMAIL_SECRET` Worker secret.

## CSRF model

The Worker issues its own CSRF token cookie (double-submit pattern) at
`GET /api/csrf`. The D1 routes (mounted in `research/src/index.ts:95-110`)
use this token for write requests.

**The proxied routes do not use the Worker's CSRF cookie** — they use
the api-server's session + Origin guard, because applying the Worker's
CSRF cookie to proxied requests broke auth (see comment in
`research/src/index.ts:163-167`).

## How to add a new route

1. **If it needs users / records / S3** (the patient record system):
   add it to `artifacts/api-server/src/routes/<name>.ts` and mount it
   in `artifacts/api-server/src/routes/index.ts`. The Worker
   automatically proxies it.

2. **If it's a feature table that doesn't share users with the record
   system** (e.g. consent, cohort, ML models — these are "feature
   apps" with their own D1 schema): add a Hono sub-app under
   `research/src/routes/<name>.ts`, register it in
   `research/src/index.ts` with `app.route("/api/<name>", <name>App)`,
   and add its DDL to `research/schema.sql` (use `research/scripts/check-schema.ts`
   in CI to catch schema drift).

3. **If it's a feature for the admin root** (legacy worker): add it
   under `research/src/routes/<name>.ts` exporting `*Handlers` (not
   `*App`), and register it in `artifacts/worker-api/src/index.ts`.
   Note: prefer adding it to the active worker first; only the admin
   root stays on the legacy worker.

4. **Update this file** with the new path and the storage it lives in.

## Files & key code paths

| Concern                       | Path                                                      |
| ----------------------------- | --------------------------------------------------------- |
| Active Worker bootstrap + middleware | `research/src/index.ts`                            |
| Proxy to api-server           | `research/src/index.ts:proxyToBackend`                    |
| Legacy Worker bootstrap       | `artifacts/worker-api/src/index.ts`                       |
| D1 schema (both workers)      | `research/schema.sql`                                     |
| D1 schema bootstrap           | `research/src/lib/db-bootstrap.ts`                        |
| Schema consistency check      | `research/scripts/check-schema.ts`                        |
| api-server bootstrap + mounts | `artifacts/api-server/src/app.ts` + `src/routes/index.ts`  |
| Drizzle migrations (api-server) | `lib/db/drizzle/`                                        |
