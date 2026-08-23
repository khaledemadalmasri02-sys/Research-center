# Upgrade Plan — MedResearch Data Platform

## 1. Current Architecture Assessment (what exists today)

- **Backend** (`artifacts/api-server`): Express, `express-session` backed by Postgres (`app.ts:34`), `bcryptjs` auth from env (`auth.ts:8`). Auth has **no roles, no DB users, no per-user isolation** — `requireAuth` only checks `session.authenticated` (`auth.ts:60`).
- **DB** (`lib/db`): Drizzle ORM on Postgres. Single hardcoded `patients` table (`patients.ts`). A separate **Cloudflare D1/SQLite** schema exists in `research/schema.sql` (worker tunnel).
- **Frontend** (`artifacts/research-data`): React + Vite + TanStack Query + Shadcn/ui + Tailwind. Has `use-mobile` hook and a DB viewer page (`database.tsx`).
- **Storage**: MinIO S3, radiology images.

## 2. Key Risks Found (must fix as part of the plan)

- `routes/schema.ts:42` builds `SELECT * FROM "${table}"` from a user-supplied param — **SQL injection / arbitrary table access** for any logged-in user. Needs allow-listing + scope gating.
- Auth credentials live in **env vars** (`APP_USERS`) instead of a managed `users` table — no way to manage, lock, or role users.
- No self-service sign-up and no admin approval gate — accounts are only created via env.
- No audit trail, rate limiting, CSRF, or lockout on login.

---

## 3. Phased Roadmap

### Phase A — Identity & Access Foundation (covers #1, #2, #3)

**A1. Users table + Admin Controller** (new migration `lib/db/src/schema/users.ts`)
```
users: id, username (unique), password_hash, role ('admin'|'user'),
       can_admin_access (bool), status ('active'|'pending'|'suspended'),
       mfa_secret, failed_attempts, locked_until, created_by, created_at, updated_at
sessions: extend with user_id + role
```
- Replace env-based auth (`auth.ts`) with DB lookup. Keep `bcryptjs` (already a dep).
- **Advanced secure sign-in (admin)**: bcrypt verify, **rate limiting + lockout** (`express-rate-limit`) on `/auth/login`, **CSRF token** on state-changing routes, password-strength policy, optional **TOTP 2FA** (step-up on admin). Admin accounts are bootstrapped by the first admin / env seed and managed through the controller.

**A2. Admin Panel / "Commander"** (new `routes/admin.ts`, `pages/admin/*`)
- Admin-only controller: review/approve sign-up applications, list/create/disable users, manage roles, view audit log.
- Enforce `can_admin_access` server-side (new `requireAdmin` middleware), never trust the client.

**A3. Proper sign-up sent to admin for confirmation** (#2)
- New table `signup_requests: id, username, password_hash, full_name, email, reason, status('pending'|'approved'|'rejected'), requested_at, reviewed_by, reviewed_at`.
- `POST /auth/signup` validates input, rate-limits, stores a **pending** application (password hashed with bcrypt), and does **not** create a live account yet.
- Admin reviews in the panel; `POST /admin/signup/:id/approve` creates the real `users` row with `role='user'`, `can_admin_access=false`, `status='active'`. Rejection marks the request `rejected`.
- The applicant is notified of the decision and only then can log in.

**A4. Confirmed sign-up -> website-only login** (#3)
- On approval, the user gets `role='user'`, `can_admin_access=false`.
- `POST /auth/login`: if `can_admin_access` is false, issue a **limited session scope** (website-only, no admin routes). Add a guard so these users are blocked from `/admin/*` and `/api/admin/*` (HTTP 403). They can use the website/records but not the commander.
- Pending/rejected/suspended users are refused at login with a clear message.

### Phase B — Extensible Records per User (covers #4)

**B1. Dynamic record schemas** (new migrations)
```
record_definitions: id, user_id (FK), name, fields(JSON:[{key,label,type:'text'|'number'|'date'|'select'|'image'|'textarea'}]), created_at
records: id, user_id, definition_id, data(JSONB), created_at, updated_at
record_images: id, record_id, field_key, object_key, created_at  -- S3-backed images
```
- Keep legacy `patients` table as one seeded `record_definition` for backward compatibility.
- **Per-user isolation**: every query filters by `user_id`; admin can view all (read-only scope).
- Image fields upload via existing presigned-URL flow (`storage.ts`) and store `object_key` in `record_images`.

**B2. API** (`routes/records.ts`): CRUD for definitions + records, list/attach images. Reuse `ObjectStorageService` and `radiologyImageService` patterns.
**B3. UI** (`pages/records/*`, `components/record-form.tsx`): dynamic form builder rendered from `fields` metadata; image-field upload widget; per-user record list/grid.

### Phase C — Audit & Hardening (covers #5)

- **Database**: replace `schema.ts` raw query with allow-listed table reads + role scope; add indexes on `user_id`; run `pnpm typecheck` + `db:migrate`.
- **Fetch**: review `fetchAndUploadImage` (`patients.ts:694`) — add SSRF guard (block private IP ranges / restrict to image content-types), timeouts, size caps.
- **Scheme/migrations**: adopt DrizzleKit `migrate` workflow; align Postgres schema with the D1 schema; document dual-DB.
- Add **audit_log** table + middleware logging auth/sign-up/admin/record events.

### Phase D — Feedback System (covers #6)

- `feedback: id, user_id, type, message, rating, status('new'|'reviewed'), created_at`.
- `POST /api/feedback` (authenticated), admin review view in the panel, optional email/notify on submit.

#### Phase D — Concrete Implementation Plan

**Schema / DB**
1. `lib/db/src/schema/feedback.ts` — new `feedbackTable` (Drizzle) + `FEEDBACK_TYPES`, `FEEDBACK_STATUSES` constants, `FeedbackRow` type, mirroring the plan columns.
2. `lib/db/src/schema/index.ts` — export the new feedback schema.
3. `artifacts/api-server/src/index.ts` — add `feedback` `CREATE TABLE IF NOT EXISTS` + indexes inside `ensureAuthTables()` (runtime table bootstrap; the app creates tables there, not via drizzle-kit push).

**Backend API** (`artifacts/api-server/src/routes/feedback.ts`)
4. `POST /api/feedback` (mounted with `requireAuth`) — any authenticated user submits `{ type, message, rating }`; validates type allow-list, non-empty message (<=5000 chars), rating 1–5; inserts row with `user_id` + `status='new'`; writes audit `feedback.submit`.
5. `GET /api/feedback` — admin only (checks `req.session.canAdminAccess`, 403 otherwise); returns newest-first list joined with `username`.
6. `PATCH /api/feedback/:id/review` — admin only; marks `status='reviewed'`; writes audit `feedback.review`.
7. `artifacts/api-server/src/routes/index.ts` — `router.use(requireAuth, feedbackRouter)`.

**Frontend** (`artifacts/research-data`)
8. `src/pages/feedback.tsx` — user feedback form (type select, message textarea, 1–5 rating, submit via TanStack mutation) with success/error states.
9. `src/App.tsx` — lazy-load + `<Route path="/feedback" ...>`.
10. `src/components/layout.tsx` — add "Feedback" nav link (all authenticated users).
11. `src/pages/admin.tsx` — new "Feedback" tab: fetch `/api/feedback`, table of submissions (user, type, rating, status, message, date) + "Mark reviewed" action.

**Verification**
12. `pnpm run typecheck` across workspace; manual smoke: submit feedback as a user, review as admin.

### Phase E — Responsive Desktop + Mobile (covers #7)

- Add mobile **bottom navigation** + collapsible sidebar (use existing `use-mobile.tsx`).
- Make `Table` views degrade to **card lists** on small screens (`database.tsx`, record lists).
- Ensure viewport meta, touch-friendly targets (>=44px), and test breakpoints (375 / 768 / 1280).
- Optional: light **PWA** manifest for installable mobile use.

---

## 4. Suggested Extra Features to Advance the Project (#8)

Concrete implementation plans, ordered by priority/dependency. Each item lists the schema, backend, frontend, and verification steps, following the same structure as Phase D.

### #8.1 — Audit & Activity Timeline (per user + global)

Builds on the `audit_log` table from Phase C.

**Schema / DB**
1. `lib/db/src/schema/audit.ts` — extend with an index on `created_at`; add a `scope` note (already has `user_id`, `action`, `entity`, `entity_id`, `detail`, `ip`).
2. `artifacts/api-server/src/index.ts` — add `CREATE INDEX IF NOT EXISTS "IDX_audit_created" ON "audit_log" ("created_at")` in `ensureAuthTables()` (runtime bootstrap).

**Backend API** (`artifacts/api-server/src/routes/audit.ts`, new)
3. `GET /api/audit` — admin only (checks `req.session.canAdminAccess`); returns newest-first global timeline, paginated (`?limit=&offset=`), optional `?action=` and `?userId=` filters.
4. `GET /api/audit/me` — any authenticated user; returns only their own rows (scoped to `req.session.userId`), paginated.
5. `artifacts/api-server/src/routes/index.ts` — `router.use(requireAuth, requireAdmin, auditRouter)` for `/api/audit`; `router.use(requireAuth, auditMeRouter)` for `/api/audit/me`.
6. Ensure `writeAudit` is called for the remaining events: sign-up approve/reject (`admin.ts`), record create/update/delete (`records.ts`), login failures/locks (`auth.ts`).

**Frontend** (`artifacts/research-data`)
7. `src/pages/activity.tsx` — global timeline (admin) with filter chips (action type) + infinite/paginated scroll.
8. `src/pages/activity-me.tsx` — personal timeline; link from user menu in `layout.tsx`.
9. `src/App.tsx` — lazy-load + routes `/activity` (admin) and `/activity/me` (all users).
10. `src/components/layout.tsx` — add "Activity" nav (admin) + "My Activity" (all users).

**Verification**
11. `pnpm run typecheck`; manual: submit actions as a user, view personal + global timelines as admin.

### #8.2 — Fine-grained RBAC + API Tokens

Extends `users.role` (`'admin'|'user'`) into `viewer|editor|admin` and adds programmatic tokens.

**Schema / DB**
1. `lib/db/src/schema/users.ts` — change `role` default to `'viewer'`; add `can_edit` boolean (editor/admin true) and keep `can_admin_access`. Add `api_tokens` table: `id, user_id (FK), name, token_hash (sha256), scopes (text[] or jsonb), last_used_at, created_at, revoked_at`.
2. `artifacts/api-server/src/index.ts` — add `api_tokens` `CREATE TABLE IF NOT EXISTS` + index on `user_id`; relax `users.role` check to the three values (or store as free text with app-level validation).
3. `lib/db/src/schema/index.ts` — export `apiTokensTable`.

**Backend**
4. `artifacts/api-server/src/middlewares/requireRole.ts` — new middleware factory `requireRole('editor'|'admin')` and `requireEdit` that checks `req.session.role`/`can_edit`. Apply `requireEdit` to record create/update/delete and patient mutations; keep `requireAdmin` for admin routes.
5. `artifacts/api-server/src/lib/apiToken.ts` — `hashToken()` (sha256), `issueToken(userId, name, scopes)`, `authenticateToken(req)` that resolves a session-like `req.apiUser` from `Authorization: Bearer <token>`; falls through to cookie auth when absent.
6. `artifacts/api-server/src/routes/tokens.ts` (new, `requireAuth`) — `POST /api/tokens` (create, returns plaintext once), `GET /api/tokens` (list own, never return hashes), `DELETE /api/tokens/:id` (revoke). `PATCH /api/admin/users/:id` already handles role changes; extend `admin.ts` to accept `role` in `{viewer|editor|admin}`.
7. `artifacts/api-server/src/routes/index.ts` — `router.use(apiTokenAuth, ...)` early so Bearer tokens work on protected routes; `router.use(requireAuth, tokensRouter)`.

**Frontend**
8. `src/pages/admin.tsx` — role select per user (viewer/editor/admin) in the Users tab.
9. `src/pages/api-tokens.tsx` — list/create/revoke tokens; show plaintext once with copy + warning.
10. `src/App.tsx` + `layout.tsx` — route `/api-tokens` + nav (all authenticated users).

**Verification**
11. `pnpm run typecheck`; test: viewer cannot POST records (403), editor can, token auth hits API via `curl -H "Authorization: Bearer ..."`.

### #8.3 — Search & Filter, Saved Views, Full-text Search, CSV/Excel Export

**Schema / DB**
1. `lib/db/src/schema/records.ts` — add a GIN tsvector index: `ALTER TABLE records ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', data::text)) STORED;` + `CREATE INDEX IF NOT EXISTS "IDX_records_search" ON records USING GIN(search_tsv)`. (Run in `ensureAuthTables()` or a migration; generated column works at runtime.)
2. `lib/db/src/schema/saved_views.ts` (new) — `id, user_id, name, definition_id, filters (jsonb), sort (jsonb), created_at`. Export from `index.ts`.

**Backend**
3. `artifacts/api-server/src/routes/search.ts` (new, `requireAuth`) — `GET /api/records/:definitionId/search?q=&filters=&sort=` using the GIN index (`@@ plainto_tsquery(...)`) plus JSONB field filters; respects `user_id` isolation. `GET /api/search/global?q=` across definitions the user owns/sees.
4. `artifacts/api-server/src/routes/saved-views.ts` (new) — CRUD for saved views scoped to `user_id`.
5. `artifacts/api-server/src/routes/records.ts` — add `GET /api/records/:definitionId/export?format=csv|excel` streaming a file (reuse `exceljs` if available, else `csv-stringify`); admin export may include all users' records for a definition (read-only scope).
6. `artifacts/api-server/src/routes/index.ts` — mount `searchRouter`, `savedViewsRouter`.

**Frontend**
7. `src/components/record-search-bar.tsx` — search input + filter/sort popover; writes URL state.
8. `src/components/saved-views.tsx` — save current view / load / delete; stored per user.
9. `src/pages/record-list.tsx` — integrate search bar + saved views + Export button (CSV/Excel) using existing TanStack queries.
10. `src/pages/records.tsx` / `patients.tsx` — expose global search entry.

**Verification**
11. `pnpm run typecheck`; manual: search a term, save a view, re-open, export CSV and open in Excel.

### #8.4 — Dark Mode + i18n (Arabic)

**Dark mode**
1. Add `class` strategy: `tailwind.config` `darkMode: 'class'`; `src/hooks/use-theme.ts` toggles `document.documentElement.classList`. Persist in `localStorage`.
2. `src/components/layout.tsx` — theme toggle button (Sun/Moon). `src/index.css` — ensure Shadcn CSS variables cover `:root` and `.dark`.

**i18n**
3. Add `i18next` + `react-i18next` + `i18next-browser-languagedetector`. `src/i18n/index.ts` with `en` + `ar` resources; `ar` translates nav/labels (Arabic already present in data via `final_confirmed_diagnosis_ar`).
4. `src/components/language-switcher.tsx` — EN/AR toggle; set `dir="rtl"` on `<html>` when AR.
5. Wrap user-facing strings in `t(...)` across `layout.tsx`, `home.tsx`, `feedback.tsx`, `admin.tsx`, record forms. Keep it incremental (start with chrome/nav + feedback).

**Verification**
6. `pnpm run typecheck`; manual: toggle dark mode (persists on reload), switch to Arabic (layout flips RTL), submit feedback in AR.

### #8.5 — Notifications (in-app + email)

**Schema / DB**
1. `lib/db/src/schema/notifications.ts` (new) — `id, user_id, type, title, body, link, read (bool), created_at`. Export from `index.ts`. Add `CREATE TABLE IF NOT EXISTS` + index `user_id` in `index.ts`.

**Backend**
2. `artifacts/api-server/src/lib/notifications.ts` — `notify(userId, {type,title,body,link})` inserts a row and (optionally) enqueues an email. Email via existing SMTP/SES client or `nodemailer` (add dep) using `SMTP_*` env.
3. Wire notifications into: sign-up approve/reject (`admin.ts`) → notify the applicant (`signup_requests.user_id`/username lookup); feedback reply/review (`feedback.ts`) → notify the feedback author.
4. `artifacts/api-server/src/routes/notifications.ts` (new, `requireAuth`) — `GET /api/notifications` (own, unread first), `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`.
5. `artifacts/api-server/src/routes/index.ts` — mount `notificationsRouter`.

**Frontend**
6. `src/components/notification-bell.tsx` — badge with unread count (poll or TanStack refetch interval); dropdown list; mark read.
7. `src/hooks/use-notifications.ts` — query + mutation. Add to `layout.tsx` top bar / header.

**Verification**
8. `pnpm run typecheck`; manual: approve a sign-up, applicant sees in-app bell + (if SMTP configured) email.

### #8.6 — Automated Backups + Health/Metrics Dashboard

**Backups**
1. `scripts/backup.ts` (new) — `pg_dump` to a timestamped file, upload to S3 (`S3_BUCKET` + `/backups/`), rely on S3 versioning for retention. Add `npm script` `backup`.
2. Schedule via cron in `docker-compose.yml` or a worker; document in README. Ensure MinIO/S3 bucket has versioning enabled.

**Health / Metrics**
3. `artifacts/api-server/src/routes/health.ts` — extend with `/api/health/metrics` (admin): DB row counts (`users`, `records`, `feedback`, `signup_requests`), session count, S3 reachable, uptime. Reuse existing `health.ts`.
4. `src/pages/admin.tsx` — new "System" tab: metrics cards + "Run backup now" button (`POST /api/admin/backup` that triggers `scripts/backup.ts` via child process or shared lib) + last-backup timestamp.

**Verification**
5. `pnpm run typecheck`; manual: run `pnpm backup`, confirm object in S3; open System tab, see counts.

### #8.7 — Session Management UI

**Schema / DB**
1. Reuse `session` table (express-session). Optionally add `user_id` index/column for lookup (sessions are JSON; extract `user_id` from `sess` JSON in queries).

**Backend**
2. `artifacts/api-server/src/routes/sessions.ts` (new, `requireAuth`) — `GET /api/sessions` lists the user's active sessions (parse `session` rows where `sess->'userId' = req.session.userId`), marking the current `sid`; `DELETE /api/sessions/:sid` revokes (deletes row) another session; `DELETE /api/sessions` revokes all others. Admin may list any user's via `requireAdmin`.
3. `artifacts/api-server/src/routes/index.ts` — mount `sessionsRouter`.

**Frontend**
4. `src/pages/sessions.tsx` — list active sessions (device/IP from `sess` detail if stored), current session highlighted, revoke buttons.
5. `src/App.tsx` + `layout.tsx` — route `/sessions` + nav (all users).

**Verification**
6. `pnpm run typecheck`; manual: open in two browsers, revoke the other session, confirm it's logged out.

---

## 5. Recommended Implementation Order

1. Phase A (users, admin, secure login, sign-up approval) — foundation, unblocks everything.
2. Phase C audit/hardening — fix the injection risk early.
3. Phase B (extensible records) — core feature.
4. Phase D (feedback) — small, independent.
5. Phase E (responsive) — polish.
6. #8.1 Audit timeline — cheap, leverages Phase C.
7. #8.2 RBAC + API tokens — security foundation before exposing programmatic access.
8. #8.5 Notifications — depends on sign-up/feedback flows already built.
9. #8.3 Search/filter/export — core usability for records.
10. #8.4 Dark mode + i18n — polish, can parallelize with #8.3.
11. #8.7 Session management — small, uses existing session table.
12. #8.6 Backups + metrics — ops, do last (needs S3/cron).

## 6. Testing & Verification

- `pnpm run typecheck` and `pnpm run build` after each item.
- Add API tests for: auth roles (viewer/editor/admin), API-token auth, sign-up approval flow (pending -> approved -> website-only login), record isolation, search/filter, and session revoke.
- Manual responsive checks at 375/768/1280 widths (Phase E).
- Smoke each #8 feature end-to-end before moving to the next.

This plan keeps your existing stack (Drizzle, Express session, MinIO, Shadcn, i18next) and layers RBAC, search, notifications, and ops on top without a rewrite.

## 7. Implementation Status (all #8 items implanted)

All seven #8 features are implemented in code and pass `pnpm run typecheck`:

- **#8.1** — `routes/audit.ts` (`/api/audit`, `/api/audit/me`); `activity.tsx`, `activity-me.tsx`; `audit_log(created_at)` index added.
- **#8.2** — `api_tokens` schema + `routes/tokens.ts`; `lib/apiToken.ts` (Bearer auth → synthetic session); `middlewares/requireEdit.ts` gates record mutations; `users.role` now `viewer|editor|admin`; admin role selector in `admin.tsx`.
- **#8.3** — `routes/search.ts` (tsvector + field filters, global search); `saved_views` schema + `routes/saved-views.ts`; CSV/Excel export in `records.ts`; `records-toolbar.tsx` wired into `record-list.tsx`.
- **#8.4** — `next-themes` provider + `theme-toggle.tsx`; `i18n/` (en/ar) with RTL; `language-switcher.tsx`; nav/activity/tokens/sessions translated.
- **#8.5** — `notifications` schema + `routes/notifications.ts` + `lib/notifications.ts`; `notification-bell.tsx`; wired into sign-up approve/reject and feedback review.
- **#8.6** — `routes/backup.ts` (pg_dump → S3 `/backups/`) and `routes/metrics.ts` (`/api/metrics`); System tab in `admin.tsx`.
- **#8.7** — `routes/sessions.ts` + `sessions.tsx` (list/revoke own sessions).

New env (optional): `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` for email notifications; `S3_BUCKET` for backups.

---

## D1 worker addendum (same feature set, served from the edge)

The Cloudflare Worker (`research/src`) now mirrors the api-server feature set
directly on D1 so it works standalone. Beyond the users/RBAC/tokens/audit/
notifications/feedback/sessions already present, this session added:

- **#8.3** — `routes/search.ts` (`/api/search` parameterized; `/api/saved-views`
  CRUD) on the worker.
- **#8.1** — `routes/audit.ts` (`/api/audit` admin global + `/api/audit/me`).
- **Security (Phase A1 / C)** — `lib/security.ts` `ssrfCheck()` (wired into
  `patients.ts` image import) + `csrfGuard()` / `issueCsrfToken()` applied to
  the `/api/*` proxy (`GET /api/csrf` issues the token).
- **CI + dual-DB guard** — `.github/workflows/ci.yml` and
  `research/scripts/check-schema.mjs` enforce `schema.sql` ↔ `db-bootstrap.ts`
  table parity (caught & fixed a drift where `validation_rules`, `patients`,
  `sessions`, `feedback` were missing from the runtime bootstrap).

Verified: `tsc --noEmit` + `pnpm test` → 97 tests pass; schema check green (32
tables in both sources).
