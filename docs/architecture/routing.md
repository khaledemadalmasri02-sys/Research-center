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

There is no second Worker. `artifacts/worker-api/` was deleted in the
2026-10 remediation pass, along with `artifacts/local-api/` and the
`research/ui/` duplicate SPA (77 files total). One Worker, one api-server.

## Origin is forwarded, not rewritten

**This section previously described the opposite of what the code did.**

The proxy used to `headers.set("origin", base)`, overwriting the client's
`Origin` with the api-server's own base URL. That made the api-server's
same-origin guard pass unconditionally — for every host, always — so any
site on the internet could POST `/api/*` through this Worker with a
logged-in victim's session cookie.

`proxyToBackend()` (`research/src/index.ts:206`) now:

1. reads the client's `Origin` and rejects the request with **403** if its
   host is not in `CANONICAL_HOSTS` (`research-center.fit`,
   `www.research-center.fit`) — `index.ts:214-228`. An absent `Origin` is
   left alone (same-origin navigation, curl, server-to-server);
2. forwards the client's `Origin` **unchanged**, deleting it when absent, so
   the api-server's guard can actually evaluate it — `index.ts:232-236`.

Consequences for `ALLOWED_ORIGINS`:

- It must list the origins a **browser** actually sends, i.e. the SPA's
  public origin and any subdomain that serves it, plus the dev SPA hosts
  (`localhost:4003`, `localhost:4004` and their `127.0.0.1` forms). It no
  longer needs the api-server's own URL as a substitute for the front-end
  hostname.
- The api-server's CORS config gates **direct** browser → api-server traffic
  (local dev, health probes). Production traffic arrives via the Worker,
  which is not a browser and sends no CORS preflight.
- The api-server additionally enforces an **Origin guard** on non-safe
  methods independently of the CORS allowlist
  (`artifacts/api-server/src/app.ts:150-162`), so a future allowlist
  regression cannot silently re-open cross-origin writes.

Both storage domains are read by the same Worker. Neither D1 nor Postgres
is authoritative for the whole patient record system — see the KNOWN ISSUE
block in `research/src/index.ts:40-72`: records are written to Postgres
behind the api-server, and the D1 clinical tables are empty in production.

## History (why this doc used to describe two Workers)

`artifacts/worker-api/` was the first Worker. `research/` replaced it for
the public site and added the proxy-to-api-server architecture, and the
admin root kept mounting parts of the legacy worker. That second Worker
has since been deleted, together with `artifacts/local-api/`. Both once
shared the D1 schema (`research/schema.sql`).

## Routes

### Worker D1 routes

These are mounted in `research/src/index.ts:151-177` (the `D1_ROUTE_MOUNTS`
array and the loop that registers `csrfGuard` + `app.route()` for each).
The path below is the full URL the browser sees.

| Path                          | Source file                          | Storage |
| ----------------------------- | ------------------------------------ | ------- |
| `/api/csrf`                   | `research/src/index.ts:182`          | none (issues the double-submit cookie) |
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
| `/api/gdpr`                   | `research/src/routes/gdpr.ts`        | D1 (+ Postgres + object storage) |
| `/api/ingest`                 | `research/src/routes/ingest.ts`      | D1      |
| `/api/search`                 | `research/src/routes/search.ts`      | D1      |
| `/api/codings`                | `research/src/routes/coding.ts`      | D1      |
| `/api/record-versions`        | `research/src/routes/recordVersions.ts` | D1   |
| `/api/record-verify`          | `research/src/routes/recordVerify.ts` | D1    |
| `/api/unsubscribe`            | `research/src/routes/unsubscribe.ts` | D1      |

**`/api/saved-views` is NOT a D1 route.** It is handled by the Postgres
api-server and proxied through the Worker, so it shares the same session as
the rest of the records feature (`research/src/index.ts:178-179`). This table
previously listed it as D1 via a `savedViewsApp` in
`research/src/routes/search.ts`; that module does not export one.

Note: `/api/search` is mounted on both the Worker (D1) and the api-server
(Postgres).

### Deleted in the 2026-10 pass

These nine Worker route modules and the legacy Worker were deleted; nothing
imports them any more:

- `artifacts/worker-api/` (the whole Worker, incl. `DEPLOY.md`)
- `artifacts/local-api/` (the whole package)
- `research/src/routes/{admin,audit,auth,extras,feedback,patients,records,storage,voice}.ts`

The nine are **not** to be re-added: every route they served is either
owned by the api-server (auth, patients, records, feedback, admin, storage,
voice) or was never reachable from the shipped SPA.

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
- `/api/storage/*` — S3 presigned **upload** URLs, authenticated object
  streaming (`/storage/objects/*`). `GET /api/storage/public-objects/*` is
  **retired** and answers 410 (see `STORAGE.md`).
- `/api/audit` — personal activity timeline
- `/api/admin/*` — admin (user mgmt, backups)
- `/api/sessions/*` — session list/revoke
- `/api/tokens/*` — API token CRUD
- `/api/feedback` — feedback widget submissions
- `/api/notifications/*` — user notifications
- `/api/saved-views/*` — saved views (Postgres; not a D1 route)
- `/api/search` — search (Postgres)
- `/api/inbound-email` — Cloudflare Email Routing target (secret-gated)
- `/api/crash-report` — frontend crash reports (anonymous by design,
  rate limited)
- `/api/gdpr/erasure/:patientId` — **DELETE**, secret-gated (not session-
  gated). The Worker calls this for the Postgres half of a patient erasure.
  See `artifacts/api-server/src/routes/gdpr.ts`.
- `/api/tour-media/*`, `/api/tour-config` — in-product tour media
- `/api/healthz` — api-server health probe (the Dockerfile's
  `HEALTHCHECK` points here; `/api/health` is the Worker's D1 health
  probe)
- `/api/metrics` — metrics
- `/api/backup` — admin-only DB backup

**Mount order is not an authentication mechanism.** Do not write
`router.use(requireAuth, someRouter)` — Express turns a leading handler
into one layer at path `/`, so it guards *every* request that reaches that
point in the stack, including requests no sub-router below it handles.
Authenticate per route, inside each route file. The full rationale and the
allowlist test are in `artifacts/api-server/src/routes/index.ts:32-59`.

See `artifacts/api-server/src/routes/index.ts` for the full mount
list.

### Static assets

Anything that doesn't match `/api/*` falls through to the Worker's
`ASSETS` binding, which serves the built SPA from `research/public/`. The
Worker also injects a per-host canonical `<link>` and a JSON-LD
`<script>` for SEO on HTML responses — see
`research/src/index.ts:74-116`. Injection only happens for hosts in
`CANONICAL_HOSTS`.

### Inbound email

`research/src/index.ts:handleEmail` is the Cloudflare Email Routing
handler. It parses the message with PostalMime and POSTs it to the
api-server's `/api/inbound-email` endpoint with the
`INBOUND_EMAIL_SECRET` Worker secret. If the backend rejects the message
(non-2xx) the handler calls `message.setReject(...)` so the sender learns
their mail was not stored.

## CSRF model

The Worker issues its own CSRF token cookie (double-submit pattern) at
`GET /api/csrf` (`research/src/index.ts:182`), and `csrfGuard()` enforces
it on the D1 routes — registered per mount at `index.ts:171-177` for both
the bare prefix and `/*/…` sub-paths.

**This guard was previously defined but never imported, so no D1 mutation
was protected at this layer.** It is now genuinely active. `csrfGuard`
skips `GET`/`HEAD`/`OPTIONS` and `Authorization: Bearer` requests, compares
the cookie to the `X-CSRF-Token` header with a length-independent
constant-time helper, and issues the cookie with `SameSite=Strict` plus
`Secure` in production. The cookie is deliberately **not** `HttpOnly`
(double-submit requires JS to read it) and does **not** use the `__Host-`
prefix (the Worker is bound to both apex and `www.`, which the prefix
forbids). See `issueCsrfToken()` in `research/src/lib/security.ts:458`.

**No state-changing endpoint may be a GET.** `SameSite=Lax` permits a
top-level cross-site navigation, so a mutating GET is a CSRF write
primitive reachable from an `<img src>` on any origin. `csrfGuard` does
not cover GET — that is by design, and it is why
`GET /api/deidentify/export` became `POST`.

**The proxied routes do not use the Worker's CSRF cookie** — they use the
api-server's `connect.sid` session plus two Origin checks (the Worker's
`CANONICAL_HOSTS` allow-list and the api-server's own guard). Applying the
Worker's `csrf` cookie there broke login; see the comment at
`research/src/index.ts:143-147`.

## How to add a new route

1. **If it needs users / records / S3** (the patient record system):
   add it to `artifacts/api-server/src/routes/<name>.ts`, mount it in
   `artifacts/api-server/src/routes/index.ts`, apply auth **inside the
   route file**, and add it to the allowlist in
   `artifacts/api-server/test/route-auth-policy.test.ts`. The Worker
   automatically proxies it.

2. **If it's a feature table that doesn't share users with the record
   system** (e.g. consent, cohort, ML models — these are "feature
   apps" with their own D1 schema): add a Hono sub-app under
   `research/src/routes/<name>.ts`, add it to `D1_ROUTE_MOUNTS` in
   `research/src/index.ts` (which is what registers `csrfGuard` and
   `app.route()`), and add its DDL to `research/schema.sql` (use
   `research/scripts/check-schema.mjs` to catch schema drift).

   Before you do: read the KNOWN ISSUE block at
   `research/src/index.ts:40-72`. If the feature reads patient data, the
   D1 store is empty in production and a new D1 route will look healthy
   while returning nothing.

3. **Update this file** with the new path and the storage it lives in, and
   note whether it needs an edit-capable role rather than mere
   authentication (`requirePatientScope()` exists because D1 `patients`
   has no owner column).

## Files & key code paths

| Concern                       | Path                                                      |
| ----------------------------- | --------------------------------------------------------- |
| Worker bootstrap + middleware | `research/src/index.ts`                                    |
| D1 route mounts + CSRF guard  | `research/src/index.ts:151-177`                            |
| `CANONICAL_HOSTS` + origin check | `research/src/index.ts:35-38`, `:214-228`               |
| Proxy to api-server           | `research/src/index.ts:206-261` (`proxyToBackend`)          |
| Inbound email handler         | `research/src/index.ts:292-326`                            |
| D1 schema                     | `research/schema.sql`                                     |
| D1 schema bootstrap           | `research/src/lib/db-bootstrap.ts`                        |
| Schema consistency check      | `research/scripts/check-schema.mjs`                        |
| api-server bootstrap + mounts | `artifacts/api-server/src/app.ts` + `src/routes/index.ts`  |
| api-server Origin guard       | `artifacts/api-server/src/app.ts:150-162`                  |
| Drizzle migrations (api-server) | `lib/db/drizzle/`                                        |
